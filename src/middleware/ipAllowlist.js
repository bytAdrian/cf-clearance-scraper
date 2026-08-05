"use strict";

const config = require("../config");

function normalizeIp(ip) {
	const value = String(ip || "");
	return value.startsWith("::ffff:") ? value.slice(7) : value;
}

// req.ip is only trustworthy when trust proxy is scoped to the real proxy CIDR.
module.exports = function ipAllowlist(req, res, next) {
	if (
		config.allowedIps.length &&
		!config.allowedIps.includes(normalizeIp(req.ip))
	) {
		return res.status(403).json({ code: 403, message: "Forbidden" });
	}
	next();
};
