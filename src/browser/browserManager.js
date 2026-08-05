"use strict";

const { connect } = require("@bytadrian/puppeteer-real-browser");
const config = require("../config");
const logger = require("../logger");

const launchArgs = [];
if (config.chromeNoSandbox) {
	launchArgs.push("--no-sandbox", "--disable-dev-shm-usage");
}

// Encapsulated singleton state (replaces the former global.* variables).
let browser = null;
let finished = false;
let inFlight = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function start() {
	try {
		if (finished) return;
		browser = null;
		const connection = await connect({
			headless: false,
			turnstile: true,
			args: launchArgs,
			connectOption: { defaultViewport: null },
			disableXvfb: false,
		});
		browser = connection.browser;
		browser.on("disconnected", async () => {
			if (finished) return;
			logger.warn("Browser disconnected");
			await sleep(3000);
			await start();
		});
	} catch (e) {
		logger.error(e.message);
		if (finished) return;
		await sleep(3000);
		await start();
	}
}

function isReady() {
	return !!browser;
}

async function shutdown() {
	finished = true;
	if (browser) await browser.close();
}

// In-flight request accounting (replaces global.browserLength).
function acquire() {
	inFlight += 1;
}
function release() {
	if (inFlight > 0) inFlight -= 1;
}
function inFlightCount() {
	return inFlight;
}

function proxyUrl(proxy) {
	return proxy ? `http://${proxy.host}:${proxy.port}` : undefined;
}

function withTimeout(promise, ms, message) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Runs `run(page)` inside a fresh isolated context with proxy auth and a timeout,
// then closes the context exactly once on every path. This is the shared skeleton
// every handler used to repeat by hand.
async function withContext({ proxy, timeoutMs }, run) {
	let context;
	try {
		context = await browser.createBrowserContext({
			proxyServer: proxyUrl(proxy),
		});
	} catch (e) {
		throw new Error("Failed to create browser context");
	}

	const page = await context.newPage();
	if (proxy?.username && proxy?.password) {
		await page.authenticate({
			username: proxy.username,
			password: proxy.password,
		});
	}

	try {
		return await withTimeout(
			run(page, context),
			timeoutMs,
			"Timeout Error",
		);
	} finally {
		await context.close().catch(() => {});
	}
}

module.exports = {
	start,
	isReady,
	shutdown,
	acquire,
	release,
	inFlight: inFlightCount,
	withContext,
};
