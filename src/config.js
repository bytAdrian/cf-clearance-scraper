"use strict";

// Single source of truth for environment configuration. Read once at load,
// so every module sees the same parsed values instead of re-reading process.env.

const flag = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

const list = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const cliArgs = new Set(
  process.argv.slice(2).map((arg) => String(arg || "").toLowerCase())
);

const nodeEnv = process.env.NODE_ENV || "";

module.exports = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isDevelopment: nodeEnv === "development",
  port: process.env.PORT || 3000,
  authToken: process.env.authToken || null,
  browserLimit: Number(process.env.browserLimit) || 20,
  timeoutMs: Number(process.env.timeOut || 60000),
  detailedLogs:
    cliArgs.has("--verbose") ||
    cliArgs.has("--debug") ||
    flag(process.env.DETAILED_LOGS),
  allowedIps: list(process.env.allowedIps),
  trustedProxyCidr: list(process.env.trustedProxyCidr),
  corsOrigins: list(process.env.corsOrigins),
  skipLaunch: process.env.SKIP_LAUNCH === "true",
  chromeNoSandbox: flag(process.env.CHROME_NO_SANDBOX),
  trustProxyLegacy: flag(process.env.trustProxy),
};
