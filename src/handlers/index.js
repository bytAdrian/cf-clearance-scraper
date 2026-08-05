"use strict";

// Registry mapping each request mode to its handler (replaces the dispatch switch).
module.exports = {
	source: require("./getSource"),
	"turnstile-min": require("./solveTurnstileMin"),
	"turnstile-max": require("./solveTurnstileMax"),
	"waf-session": require("./wafSession"),
};
