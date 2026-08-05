"use strict";

const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const ajv = new Ajv();
addFormats(ajv);

const schema = {
	type: "object",
	properties: {
		mode: {
			type: "string",
			enum: ["source", "turnstile-min", "turnstile-max", "waf-session"],
		},
		proxy: {
			type: "object",
			properties: {
				host: { type: "string" },
				port: { type: "integer" },
				username: { type: "string" },
				password: { type: "string" },
			},
			additionalProperties: false,
		},
		url: {
			type: "string",
			format: "uri",
		},
		authToken: {
			type: "string",
		},
		siteKey: {
			type: "string",
			pattern: "^0x[A-Za-z0-9_-]{20,50}$",
		},
	},
	required: ["mode", "url"],
	additionalProperties: false,
};

function validate(data) {
	return ajv.validate(schema, data) ? true : ajv.errors;
}

module.exports = validate;
