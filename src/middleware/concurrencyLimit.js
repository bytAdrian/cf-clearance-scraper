"use strict";

const config = require("../config");
const browserManager = require("../browser/browserManager");

module.exports = function concurrencyLimit(req, res, next) {
  if (browserManager.inFlight() >= config.browserLimit) {
    return res.status(429).json({ code: 429, message: "Too Many Requests" });
  }
  next();
};
