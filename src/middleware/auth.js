"use strict";

const crypto = require("crypto");
const config = require("../config");

function getRequestToken(req) {
  const header = String(req.headers["authorization"] || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return req.body?.authToken ?? null;
}

// Hashing both sides gives equal-length buffers, which timingSafeEqual requires.
function isTokenValid(provided) {
  if (typeof provided !== "string" || !provided) return false;
  const expected = crypto.createHash("sha256").update(config.authToken).digest();
  const actual = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(actual, expected);
}

// Fail-closed only when a token is configured; when authToken is unset the check
// is skipped (dev/test), which the production startup guard prevents in prod.
module.exports = function auth(req, res, next) {
  if (config.authToken && !isTokenValid(getRequestToken(req))) {
    return res.status(401).json({ code: 401, message: "Unauthorized" });
  }
  next();
};
