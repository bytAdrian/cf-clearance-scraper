"use strict";

const config = require("../config");
const logger = require("../logger");
const browserManager = require("../browser/browserManager");

const log = logger.scoped("[turnstile-max]");

// Loads the real target page, injects a script that polls the live Turnstile
// widget for its token, then reads the token back out.
function solveTurnstileMax({ url, proxy }) {
  return browserManager.withContext(
    { proxy, timeoutMs: config.timeoutMs },
    async (page) => {
      log("Injecting turnstile token polling script", { url });
      await page.evaluateOnNewDocument(() => {
        let token = null;
        async function waitForToken() {
          while (!token) {
            try {
              token = window.turnstile.getResponse();
            } catch (e) {}
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = "cf-response";
          input.value = token;
          document.body.appendChild(input);
        }
        waitForToken();
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

      log("Token extracted", { hasToken: !!token });
      if (!token || token.length < 10) throw new Error("Failed to get token");
      return { token };
    }
  );
}

module.exports = solveTurnstileMax;
