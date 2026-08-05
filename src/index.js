"use strict";

const config = require("./config");
const logger = require("./logger");
const createApp = require("./app");
const browserManager = require("./browser/browserManager");

// Fail closed: production must not run without API authentication.
if (config.isProduction && !config.authToken) {
	logger.error(
		"FATAL: authToken is not set. Production refuses to start without API authentication - set authToken in the environment (.env).",
	);
	process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
	logger.info(`Server running on port ${config.port}`);
});
try {
	server.timeout = config.timeoutMs;
} catch (e) {}

if (!config.skipLaunch) browserManager.start();
