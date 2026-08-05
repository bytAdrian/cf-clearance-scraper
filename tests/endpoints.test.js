process.env.NODE_ENV = "development";

const app = require("../src/app")();
const browserManager = require("../src/browser/browserManager");
const request = require("supertest");

// These tests drive a real browser against live Cloudflare sites, which cannot
// pass from a CI runner's datacenter IP. Gate them behind RUN_INTEGRATION so CI
// skips them; run the full suite on the Pi with RUN_INTEGRATION=1 npm test.
const live = process.env.RUN_INTEGRATION ? test : test.skip;

beforeAll(async () => {
	if (!process.env.RUN_INTEGRATION) return;
	await browserManager.start();
	while (!browserManager.isReady()) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}, 30000);

afterAll(async () => {
	if (!process.env.RUN_INTEGRATION) return;
	await browserManager.shutdown();
});

live("Scraping Page Source from Cloudflare Protection", async () => {
	return request(app)
		.post("/cf-clearance-scraper")
		.send({
			url: "https://nopecha.com/demo/cloudflare",
			mode: "source",
		})
		.expect(200)
		.then((response) => {
			expect(response.body.code).toEqual(200);
		});
}, 60000);

live("Creating a Turnstile Token With Site Key [min]", async () => {
	return request(app)
		.post("/cf-clearance-scraper")
		.send({
			url: "https://turnstile.zeroclover.io/",
			siteKey: "0x4AAAAAAAEwzhD6pyKkgXC0",
			mode: "turnstile-min",
		})
		.expect(200)
		.then((response) => {
			expect(response.body.code).toEqual(200);
		});
}, 60000);

live("Creating a Turnstile Token With Site Key [max]", async () => {
	return request(app)
		.post("/cf-clearance-scraper")
		.send({
			url: "https://turnstile.zeroclover.io/",
			mode: "turnstile-max",
		})
		.expect(200)
		.then((response) => {
			expect(response.body.code).toEqual(200);
		});
}, 60000);

live("Create Cloudflare WAF Session", async () => {
	return request(app)
		.post("/cf-clearance-scraper")
		.send({
			url: "https://nopecha.com/demo/cloudflare",
			mode: "waf-session",
		})
		.expect(200)
		.then((response) => {
			expect(response.body.code).toEqual(200);
		});
}, 60000);
