const LOG_PREFIX = "[turnstile-max]";

function log(message, data) {
  if (!global.detailedLogs) return;
  if (data !== undefined) {
    console.log(`${LOG_PREFIX} ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function solveTurnstileMax({ url, proxy }) {
  return new Promise(async (resolve, reject) => {
    const startedAt = Date.now();
    log("Starting turnstile-max request", {
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

      log("Injecting turnstile token polling script");
      await page.evaluateOnNewDocument(() => {
        let token = null;
        async function waitForToken() {
          while (!token) {
            try {
              token = window.turnstile.getResponse();
            } catch (e) {}
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          var c = document.createElement("input");
          c.type = "hidden";
          c.name = "cf-response";
          c.value = token;
          document.body.appendChild(c);
        }
        waitForToken();
      });
      log("Turnstile polling script injected");

      log("Navigating to target url", { url });
      await page.goto(url, {
        waitUntil: "domcontentloaded",
      });
      log("Navigation finished", {
        elapsedMs: Date.now() - startedAt,
        currentUrl: page.url(),
      });

      log("Waiting for cf-response input", { selector: '[name="cf-response"]', timeoutMs: 60000 });
      await page.waitForSelector('[name="cf-response"]', {
        timeout: 60000,
      });
      log("cf-response input found", { elapsedMs: Date.now() - startedAt });

      const token = await page.evaluate(() => {
        try {
          return document.querySelector('[name="cf-response"]').value;
        } catch (e) {
          return null;
        }
      });

      log("Token extracted from page", {
        hasToken: !!token,
        tokenLength: token ? token.length : 0,
        elapsedMs: Date.now() - startedAt,
      });

      isResolved = true;
      clearInterval(cl);

      log("Closing browser context");
      await context.close();
      log("Browser context closed");

      if (!token || token.length < 10) {
        log("Rejected: token missing or too short");
        return reject("Failed to get token");
      }

      log("Turnstile token resolved successfully", {
        tokenLength: token.length,
        elapsedMs: Date.now() - startedAt,
      });
      return resolve(token);
    } catch (e) {
      log("Error during turnstile-max flow", {
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
module.exports = solveTurnstileMax;
