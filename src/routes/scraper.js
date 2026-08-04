"use strict";

const express = require("express");
const config = require("../config");
const logger = require("../logger");
const browserManager = require("../browser/browserManager");
const handlers = require("../handlers");
const auth = require("../middleware/auth");
const ipAllowlist = require("../middleware/ipAllowlist");
const validate = require("../middleware/validate");
const concurrencyLimit = require("../middleware/concurrencyLimit");

const router = express.Router();

// Control-flow messages safe to echo to clients. Anything else (puppeteer /
// proxy / navigation internals) is logged server-side and returned generically.
const SAFE_CLIENT_ERRORS = new Set([
  "Timeout Error",
  "Missing url parameter",
  "Failed to create browser context",
]);

function toClientError(mode, err) {
  const message = err?.message || String(err);
  logger.error(`[${mode}] request failed:`, message);
  return {
    code: 500,
    message: SAFE_CLIENT_ERRORS.has(message) ? message : "Request failed",
  };
}

// Guard order: 401 auth -> 403 ip -> 400 schema -> 429 limit -> 500 not-ready.
router.post(
  "/cf-clearance-scraper",
  auth,
  ipAllowlist,
  validate,
  concurrencyLimit,
  async (req, res) => {
    const data = req.body;

    if (!config.skipLaunch && !browserManager.isReady()) {
      return res.status(500).json({
        code: 500,
        message: "The scanner is not ready yet. Please try again a little later.",
      });
    }

    browserManager.acquire();
    try {
      const payload = await handlers[data.mode](data);
      res.status(200).json({ ...payload, code: 200 });
    } catch (err) {
      const result = toClientError(data.mode, err);
      res.status(result.code).json(result);
    } finally {
      browserManager.release();
    }
  }
);

router.get("/health", (req, res) => {
  if (!config.skipLaunch && !browserManager.isReady()) {
    return res.status(503).json({ code: 503, status: "starting" });
  }
  res.status(200).json({ code: 200, status: "ok" });
});

module.exports = router;
