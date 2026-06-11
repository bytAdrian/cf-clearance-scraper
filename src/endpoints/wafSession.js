const LOG_PREFIX = "[waf-session]";

function log(message, data) {
	if (!global.detailedLogs) return;
	if (data !== undefined) {
		console.log(`${LOG_PREFIX} ${message}`, data);
	} else {
		console.log(`${LOG_PREFIX} ${message}`);
	}
}

async function findAcceptLanguage(page) {
	log("Fetching Accept-Language from httpbin.org/get");
	const acceptLanguage = await page.evaluate(async () => {
		const result = await fetch("https://httpbin.org/get")
			.then((res) => res.json())
			.then(
				(res) =>
					res.headers["Accept-Language"] || res.headers["accept-language"]
			)
			.catch(() => null);
		return result;
	});
	log("Accept-Language resolved", { acceptLanguage: acceptLanguage || null });
	return acceptLanguage;
}

function wafSession({ url, proxy }) {
	return new Promise(async (resolve, reject) => {
		const startedAt = Date.now();
		log("Starting waf-session request", {
			url,
			proxy: proxy
				? { host: proxy.host, port: proxy.port, hasAuth: !!(proxy.username && proxy.password) }
				: null,
			timeoutMs: global.timeOut || 60000,
		});

		if (!url) {
			log("Rejected: missing url parameter");
			return reject("Missing url parameter");
		}

		log("Creating isolated browser context");
		const context = await global.browser
			.createBrowserContext({
				proxyServer: proxy ? `http://${proxy.host}:${proxy.port}` : undefined,
			})
			.catch((err) => {
				log("Failed to create browser context", { error: err.message });
				return null;
			});

		if (!context) {
			log("Rejected: browser context creation returned null");
			return reject("Failed to create browser context");
		}

		log("Browser context created");

		let isResolved = false;

		const timeoutMs = global.timeOut || 60000;
		var cl = setTimeout(async () => {
			if (!isResolved) {
				log("Request timed out", { elapsedMs: Date.now() - startedAt, timeoutMs });
				await context.close();
				reject("Timeout Error");
			}
		}, timeoutMs);

		try {
			log("Opening new page");
			const page = await context.newPage();
			log("Page opened");

			if (proxy?.username && proxy?.password) {
				log("Applying proxy authentication");
				await page.authenticate({
					username: proxy.username,
					password: proxy.password,
				});
				log("Proxy authentication applied");
			}

			const acceptLanguage = await findAcceptLanguage(page);

			log("Enabling request interception");
			await page.setRequestInterception(true);
			page.on("request", async (request) => request.continue());

			page.on("response", async (res) => {
				try {
					const responseUrl = res.url();
					const status = res.status();
					const isTargetUrl = [url, url + "/"].includes(responseUrl);

					if (isTargetUrl) {
						log("Target response received", {
							status,
							url: responseUrl,
							elapsedMs: Date.now() - startedAt,
						});
					}

					if (
						[200, 302].includes(status) &&
						isTargetUrl
					) {
						log("Target response matched success criteria, waiting for load");
						await page
							.waitForNavigation({ waitUntil: "load", timeout: 5000 })
							.catch((navErr) => {
								log("waitForNavigation after target response finished with error", {
									error: navErr.message,
								});
							});

						const cookies = await page.cookies();
						let headers = await res.request().headers();
						delete headers["content-type"];
						delete headers["accept-encoding"];
						delete headers["accept"];
						delete headers["content-length"];
						headers["accept-language"] = acceptLanguage;

						log("Session captured", {
							cookieCount: cookies.length,
							cookieNames: cookies.map((cookie) => cookie.name),
							headerKeys: Object.keys(headers),
							userAgent: headers["user-agent"] || null,
							elapsedMs: Date.now() - startedAt,
						});

						await context.close();
						isResolved = true;
						clearInterval(cl);

						log("Waf session resolved successfully", {
							elapsedMs: Date.now() - startedAt,
						});
						resolve({ cookies, headers });
					} else if (isTargetUrl) {
						log("Target response ignored: status not 200 or 302", { status });
					}
				} catch (e) {
					log("Error in response handler", {
						error: e.message,
						elapsedMs: Date.now() - startedAt,
					});
				}
			});

			log("Navigating to target url", { url });
			await page.goto(url, {
				waitUntil: "domcontentloaded",
			});
			log("Navigation finished", {
				elapsedMs: Date.now() - startedAt,
				currentUrl: page.url(),
				resolved: isResolved,
			});
		} catch (e) {
			log("Error during waf-session flow", {
				error: e.message,
				stack: e.stack,
				elapsedMs: Date.now() - startedAt,
			});

			if (!isResolved) {
				log("Cleaning up browser context after error");
				await context.close().catch((closeErr) => {
					log("Failed to close browser context during cleanup", { error: closeErr.message });
				});
				clearInterval(cl);
				reject(e.message);
			}
		}
	});
}
module.exports = wafSession;
