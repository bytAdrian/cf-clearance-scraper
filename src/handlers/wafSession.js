"use strict";

const config = require("../config");
const logger = require("../logger");
const browserManager = require("../browser/browserManager");

const log = logger.scoped("[waf-session]");

// Derived locally from the browser locale (no external request).
async function findAcceptLanguage(page) {
	return page
		.evaluate(() => {
			const langs =
				navigator.languages && navigator.languages.length
					? navigator.languages
					: [navigator.language || "en-US"];
			return langs
				.map((lang, index) =>
					index === 0
						? lang
						: `${lang};q=${Math.max(1 - 0.1 * index, 0.1).toFixed(1)}`,
				)
				.join(",");
		})
		.catch(() => null);
}

// Captures the cookies and request headers of an established session so the
// caller can replay it.
function wafSession({ url, proxy }) {
	return browserManager.withContext(
		{ proxy, timeoutMs: config.timeoutMs },
		(page) =>
			new Promise((resolve, reject) => {
				(async () => {
					const acceptLanguage = await findAcceptLanguage(page);

					await page.setRequestInterception(true);
					page.on("request", (request) => request.continue());
					page.on("response", async (response) => {
						try {
							if (
								[200, 302].includes(response.status()) &&
								[url, url + "/"].includes(response.url())
							) {
								await page
									.waitForNavigation({
										waitUntil: "load",
										timeout: 5000,
									})
									.catch(() => {});

								const cookies = await page.cookies();
								const headers = await response
									.request()
									.headers();
								delete headers["content-type"];
								delete headers["accept-encoding"];
								delete headers["accept"];
								delete headers["content-length"];
								headers["accept-language"] = acceptLanguage;

								log("Session captured", {
									cookieCount: cookies.length,
								});
								resolve({ cookies, headers });
							}
						} catch (e) {
							log("Error in response handler", {
								error: e.message,
							});
						}
					});

					await page.goto(url, { waitUntil: "domcontentloaded" });
				})().catch(reject);
			}),
	);
}

module.exports = wafSession;
