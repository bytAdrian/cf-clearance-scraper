"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");
const browserManager = require("../browser/browserManager");

// Read once at load, resolved from this file's location (not the process cwd).
const FAKE_PAGE = fs.readFileSync(
  path.join(__dirname, "../data/fakePage.html"),
  "utf8"
);

// Serves a local page carrying only the caller's Turnstile widget, then reads
// back the solved token. siteKey is JSON-encoded (and < escaped) so it cannot
// break out of the inline <script> it is injected into.
function solveTurnstileMin({ url, siteKey, proxy }) {
  if (!siteKey) return Promise.reject("Missing siteKey parameter");

  return browserManager.withContext(
    { proxy, timeoutMs: config.timeoutMs },
    async (page) => {
      await page.setRequestInterception(true);
      page.on("request", async (request) => {
        if (
          [url, url + "/"].includes(request.url()) &&
          request.resourceType() === "document"
        ) {
          await request.respond({
            status: 200,
            contentType: "text/html",
            body: FAKE_PAGE.replace(/<site-key>/g, () =>
              JSON.stringify(String(siteKey)).replace(/</g, "\\u003c")
            ),
          });
        } else {
          await request.continue();
        }
      });

      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[name="cf-response"]', { timeout: 60000 });

      const token = await page.evaluate(() => {
        try {
          return document.querySelector('[name="cf-response"]').value;
        } catch (e) {
          return null;
        }
      });

      if (!token || token.length < 10) throw new Error("Failed to get token");
      return { token };
    }
  );
}

module.exports = solveTurnstileMin;
