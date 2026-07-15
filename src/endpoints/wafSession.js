const fs = require("fs");
const os = require("os");
const path = require("path");

const LOG_PREFIX = "[waf-session]";

function log(message, data) {
	if (!global.detailedLogs) return;
	if (data !== undefined) {
		console.log(`${LOG_PREFIX} ${message}`, data);
	} else {
		console.log(`${LOG_PREFIX} ${message}`);
	}
}

async function setupDownloadCapture(page, context, downloadPath) {
	const cdp = await page.browser().target().createCDPSession();
	const tracked = new Map(); // guid -> suggestedFilename

	let settle;
	const completion = new Promise((resolve, reject) => {
		settle = { resolve, reject };
	});

	cdp.on("Browser.downloadWillBegin", (event) => {
		let belongsToPage = true;
		try {
			belongsToPage = page.frames().some((frame) => frame._id === event.frameId);
		} catch (e) {
			belongsToPage = true;
		}
		if (!belongsToPage) return;

		tracked.set(event.guid, event.suggestedFilename || null);
		log("Download started", { suggestedFilename: event.suggestedFilename || null });
	});

	cdp.on("Browser.downloadProgress", (event) => {
		if (tracked.size && !tracked.has(event.guid)) return;

		if (event.state === "completed") {
			settle.resolve({
				guid: event.guid,
				suggestedFilename: tracked.get(event.guid) || null,
				totalBytes: event.totalBytes || null,
			});
		} else if (event.state === "canceled") {
			settle.reject(new Error("Download was canceled"));
		}
	});

	const params = {
		behavior: "allowAndName",
		downloadPath,
		eventsEnabled: true,
	};
	if (context.id) params.browserContextId = context.id;

	await cdp.send("Browser.setDownloadBehavior", params);
	log("Download behavior configured", { hasContextId: !!context.id });

	return {
		completion,
		detach: () => cdp.detach().catch(() => { }),
	};
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

function wafSession({ url, proxy, download }) {
	return new Promise(async (resolve, reject) => {
		const startedAt = Date.now();
		const isDownload = download?.enabled === true;
		const timeoutMs = isDownload
			? (download.timeout || 120000)
			: (global.timeOut || 60000);

		log("Starting waf-session request", {
			url,
			proxy: proxy
				? { host: proxy.host, port: proxy.port, hasAuth: !!(proxy.username && proxy.password) }
				: null,
			download: isDownload
				? { timeoutMs, clickSelector: download.clickSelector || null }
				: null,
			timeoutMs,
		});

		if (!url) {
			log("Rejected: missing url parameter");
			return reject("Missing url parameter");
		}

		let tmpDir = null;
		let detachCapture = null;
		const cleanupOnFailure = () => {
			if (detachCapture) detachCapture();
			if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }, () => { });
		};

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

		var cl = setTimeout(async () => {
			if (!isResolved) {
				log("Request timed out", { elapsedMs: Date.now() - startedAt, timeoutMs, isDownload });
				cleanupOnFailure();
				await context.close().catch(() => { });
				reject(isDownload ? "Download timed out" : "Timeout Error");
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

			if (isDownload) {
				tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cfcs-dl-"));
				log("Temporary download directory created");

				const capture = await setupDownloadCapture(page, context, tmpDir);
				detachCapture = capture.detach;

				log("Navigating to target url", { url });
				await page
					.goto(url, { waitUntil: "domcontentloaded" })
					.catch((err) => {
						if (/ERR_ABORTED/i.test(err.message)) {
							log("Navigation aborted, expected when the url directly triggers a download");
							return null;
						}
						throw err;
					});
				log("Navigation finished", {
					elapsedMs: Date.now() - startedAt,
				});

				if (download.clickSelector) {
					// Fire-and-forget: some pages start the download without the click,
					// so completion below stays the source of truth.
					(async () => {
						log("Waiting for click selector", { selector: download.clickSelector });
						await page.waitForSelector(download.clickSelector, {
							visible: true,
							timeout: Math.max(timeoutMs - 5000, 1000),
						});
						if (typeof page.realClick === "function") {
							await page.realClick(download.clickSelector);
						} else {
							await page.click(download.clickSelector);
						}
						log("Click selector clicked", { elapsedMs: Date.now() - startedAt });
					})().catch((err) => {
						log("Click flow failed", { error: err.message });
					});
				}

				const completed = await capture.completion;
				const filePath = path.join(tmpDir, completed.guid);
				const stat = await fs.promises.stat(filePath);

				let fallbackName = "download";
				try {
					fallbackName = path.basename(new URL(url).pathname) || "download";
				} catch (e) { }
				const filename = completed.suggestedFilename || fallbackName;

				isResolved = true;
				clearTimeout(cl);
				detachCapture();
				detachCapture = null;
				await context.close().catch(() => { });

				log("Download captured", {
					filename,
					sizeBytes: stat.size,
					elapsedMs: Date.now() - startedAt,
				});

				return resolve({
					file: {
						path: filePath,
						tmpDir,
						filename,
						contentType: null,
						size: stat.size,
					},
				});
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
				cleanupOnFailure();
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
