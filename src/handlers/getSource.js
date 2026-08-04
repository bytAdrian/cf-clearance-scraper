"use strict";

const config = require("../config");
const browserManager = require("../browser/browserManager");

// Returns the fully rendered HTML of the target page once its own response lands.
function getSource({ url, proxy }) {
  return browserManager.withContext(
    { proxy, timeoutMs: config.timeoutMs },
    (page) =>
      new Promise((resolve, reject) => {
        (async () => {
          await page.setRequestInterception(true);
          page.on("request", (request) => request.continue());
          page.on("response", async (response) => {
            try {
              if (
                [200, 302].includes(response.status()) &&
                [url, url + "/"].includes(response.url())
              ) {
                await page
                  .waitForNavigation({ waitUntil: "load", timeout: 5000 })
                  .catch(() => {});
                resolve({ source: await page.content() });
              }
            } catch (e) {}
          });
          await page.goto(url, { waitUntil: "domcontentloaded" });
        })().catch(reject);
      })
  );
}

module.exports = getSource;
