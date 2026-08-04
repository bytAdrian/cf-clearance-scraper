"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const config = require("./config");
const logger = require("./logger");
const scraperRoutes = require("./routes/scraper");

// Builds the Express app with no side effects (no listen, no browser launch),
// so tests and the entrypoint can both construct it.
function createApp() {
  const app = express();

  // Forwarded headers are only trusted from the configured proxy addresses/CIDRs
  // - a blanket value would let anything that reaches the port spoof
  // X-Forwarded-For past allowedIps.
  if (config.trustedProxyCidr.length) {
    app.set("trust proxy", config.trustedProxyCidr);
  } else if (config.trustProxyLegacy) {
    logger.warn(
      "trustProxy is set but trustedProxyCidr is not; forwarded headers stay untrusted. Set trustedProxyCidr to the proxy address/CIDR (in Docker: the compose network gateway, e.g. 172.28.0.1)."
    );
  }

  app.disable("x-powered-by");
  app.use(bodyParser.json({ limit: "50kb" }));
  app.use(bodyParser.urlencoded({ extended: true, limit: "50kb" }));
  app.use(config.corsOrigins.length ? cors({ origin: config.corsOrigins }) : cors());

  app.use(scraperRoutes);
  app.use((req, res) => res.status(404).json({ code: 404, message: "Not Found" }));

  return app;
}

module.exports = createApp;
