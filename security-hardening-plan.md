---
name: cf-scraper security hardening v2
overview: "Consolidated hardening plan for cf-clearance-scraper: remove the download capture feature entirely (session cookies/headers/tokens only), fail-closed auth with correct guard ordering, scoped trust-proxy, container network isolation and hardening, pinned base image + git dependency, and app/CI defense-in-depth. Supersedes cf-scraper_security_hardening_bbfd4f89.plan.md."
todos:
  - id: remove-download
    content: Strip download capture from wafSession.js, index.js, reqValidate.js and docs; waf-session returns cookies/headers only
    status: completed
  - id: auth-fail-closed
    content: Production startup guard requiring authToken; reorder guards to 401 -> 403 -> 400; timing-safe token compare
    status: completed
  - id: scope-trust-proxy
    content: Replace blanket trust proxy '1' with env-driven trustedProxyCidr (compose network subnet)
    status: completed
  - id: isolate-network
    content: Add explicit/internal Docker network in docker-compose.yml to prevent sibling-container access
    status: completed
  - id: container-hardening
    content: Non-root USER; no-new-privileges, cap_drop ALL, read_only + sized tmpfs, mem_limit, pids_limit, init in compose
    status: completed
  - id: pin-base-image
    content: Pin Dockerfile base to current Node 24 LTS patch tag + digest
    status: completed
  - id: pin-git-dep
    content: Commit-pin puppeteer-real-browser via git+https in package.json (drops SSH build requirement)
    status: completed
  - id: image-hygiene
    content: Move jest/supertest to devDependencies, remove unused dotenv, build with npm ci --omit=dev
    status: completed
  - id: app-defense
    content: Generic client error messages, explicit 50kb body limit, optional CORS scoping, disable x-powered-by
    status: completed
  - id: remove-httpbin
    content: Replace per-request httpbin.org Accept-Language probe with local derivation
    status: completed
  - id: ci-supply-chain
    content: SHA-pin GitHub Actions, npm ci in check_test.yaml, decide docker_hub.yaml fate on this fork
    status: completed
  - id: docs-alignment
    content: Align README quick-start with hardened deploy (authToken required, loopback bind); update project_memory.md
    status: completed
  - id: ssrf-optional
    content: Optional SSRF allowlist (schemes http/https, block private/link-local/metadata ranges) gated on threat model
    status: pending
  - id: health-optional
    content: Optional minimal unauthenticated GET /health + Docker HEALTHCHECK
    status: completed
isProject: false
---

# cf-clearance-scraper Security Hardening (v2)

> **Implementation status (2026-07-30):** all items landed except `ssrf-optional` (deliberately deferred — operator-only threat model). Verified locally: syntax + validate tests green, keyless `npm ci` from cold cache, startup guard exits without `authToken`, 401-before-400 ordering, `download` field → 400, generic 500s, `/health`, compose config valid. Still to verify **on the Pi**: `docker compose up -d --build` boots Chromium under non-root + `read_only` and solves a live challenge; adjust the `172.28.0.0/24` subnet if it collides. `npm audit fix` was applied (production deps: 0 vulnerabilities; remaining findings are dev-only in jest's tree).

Consolidated from the security review of `feature/docker-deploy-waf-download` (HEAD `108002f`) plus the follow-up plan review. Two decisions baked in:

1. **The download capture feature is removed entirely.** This service only returns session data (cookies/headers/tokens/page source). Removing it deletes the file-streaming surface, temp-file lifecycle, and the unbounded-download disk/RAM-exhaustion vector in one move — no size-cap work needed.
2. **Base image pins to the latest Node LTS** (Node 24 line) by exact patch tag + digest.

Phases are risk-ordered. Phase 0 + Phase 1 are the must-do set before the tunnel deployment.

## Phase 0 - Remove download capture

> **Breaking API change:** `reqValidate.js` uses top-level `additionalProperties: false`, so after the `download` schema block is deleted, any request still sending a `download` field gets a **400**. Clients using download capture must stop before this ships.

- [src/endpoints/wafSession.js](src/endpoints/wafSession.js): delete `setupDownloadCapture()` (lines 16-66), the `isDownload` branch (lines 157-229), and the `tmpDir`/`cleanupOnFailure` download plumbing (lines 108-113); `timeoutMs` no longer branches on download (lines 87-90). Keep only the cookies/headers session path.
- [src/index.js](src/index.js): delete `sendDownloadFile()` (lines 50-85), the download timeout extension (lines 104-111), the `result.file` branch (line 134), and the now-unused `fs`/`path` requires (lines 5-6).
- [src/module/reqValidate.js](src/module/reqValidate.js): delete the `download` schema block (lines 34-43).
- Docs: remove the "Download capture (waf-session)" section and download curl examples from [project_memory.md](project_memory.md) (lines ~30-50, 61-73, plus the `download.timeout` notes at lines 20 and 79).

## Phase 1 - Critical (do before/at deploy)

### 1. Fail closed on auth - [src/index.js](src/index.js)

Auth is currently skipped entirely when `authToken` is unset (`index.js:96`), and the token compare is a plain `!==`.

- Startup guard: if `NODE_ENV=production` and `authToken` is unset/empty, log a clear error and `process.exit(1)` before `app.listen`. Dev/test behavior unchanged (tests set `authToken`).
- Reorder route guards to **401 → 403 → 400**: schema validation currently runs before auth (`index.js:92-98`), so unauthenticated callers get detailed AJV schema feedback.
- Use `crypto.timingSafeEqual` for the token compare (hash both sides or length-guard first — `timingSafeEqual` throws on length mismatch).

### 2. Scope `trust proxy` - [src/index.js](src/index.js)

`trust proxy: 1` (`index.js:21`) trusts forwarded headers from any immediate peer → `X-Forwarded-For` spoofing by whatever can reach the port.

- Replace with `app.set('trust proxy', process.env.trustedProxyCidr)` (comma-split for multiple entries), enabled only when set.
- **Docker gotcha:** `'loopback'` is wrong inside the container — traffic published on `127.0.0.1:3000` arrives from the **bridge network gateway** (e.g. `172.x.0.1`), not loopback. `trustedProxyCidr` must be the compose network subnet/gateway. Document this next to the env var.
- `allowedIps` remains defense-in-depth (exact string match, no CIDR support); prefer enforcing the client allowlist at the Cloudflare/tunnel edge.

### 3. Isolate container network - [docker-compose.yml](docker-compose.yml)

`127.0.0.1:3000:3000` blocks external host access but not other containers on the default bridge.

- Add an explicit network; mark it `internal: false` only because outbound scraping is required — the point is that no *other* compose project/container shares it. Attach only a proxy/tunnel sidecar if one is ever added.
- Pin the subnet (`ipam`) so `trustedProxyCidr` has a stable value.
- Comment in the file: API auth must always be enabled.

## Phase 2 - Container + image hardening - [Dockerfile](Dockerfile) + [docker-compose.yml](docker-compose.yml) + [package.json](package.json)

- **Non-root `USER`** in the Dockerfile (chown `/app` during build; the stock `node` user works).
- Compose: `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, `init: true` (reaps Chromium zombies), `pids_limit` (e.g. 512 — Chromium fork-storms), `mem_limit` sized for the Pi (e.g. 4g on an 8 GB Pi 5, alongside the existing `shm_size: 1gb`).
- `read_only: true` with **explicit-size tmpfs** for `/tmp` (e.g. `size=512m,mode=1777`). Chromium + Xvfb need writable `/tmp` (X11 socket, temp profiles) **and** config/cache dirs — set `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` (and `HOME` if needed) to paths under `/tmp`, or add tmpfs mounts for them. Verify the browser boots and solves a challenge before shipping `read_only`.
- **Pin base image** (`Dockerfile:1`): `node:24-bookworm` is a floating tag. Node 24 is the current LTS line — pin the current patch + digest, e.g. `FROM node:24.<patch>-bookworm@sha256:<digest>` (multi-arch index digest covers the Pi's arm64). Look it up at implementation time: `docker buildx imagetools inspect node:24-bookworm`.
- **Pin the git dependency in `package.json`** (`package.json:38`): currently the floating `github:bytAdrian/puppeteer-real-browser` (lockfile pins commit `3571607…` but via `git+ssh`, so builds need GitHub SSH keys). Change the spec to `git+https://github.com/bytAdrian/puppeteer-real-browser.git#3571607419ec97c03843fa0d60a22cff1b93c530` and regenerate the lockfile — reproducible **and** buildable without SSH.
- **Image hygiene**: move `jest`/`supertest` to `devDependencies`, delete `dotenv` (declared but never required anywhere in `src/`), and build with `RUN npm ci --omit=dev` (`Dockerfile:17`).
- Keep `CHROME_NO_SANDBOX=true` (documented Puppeteer-in-Docker tradeoff); non-root + `cap_drop` + `no-new-privileges` + `read_only` is the pragmatic mitigation set. Stretch (optional): a custom seccomp profile permitting userns clone would allow dropping `--no-sandbox`, but it's fragile on ARM.

## Phase 3 - App defense-in-depth - [src/index.js](src/index.js), [src/endpoints/wafSession.js](src/endpoints/wafSession.js)

- **Generic client errors**: 500s currently return raw `err?.message` (`index.js:119-128`) — puppeteer/proxy/navigation internals leak to callers. Return a generic message; log the real error server-side.
- **Explicit body limit**: `bodyParser.json({ limit: '50kb' })` (`index.js:23`) — 100kb is already body-parser's implicit default; make it explicit and smaller (payloads are tiny JSON).
- **Remove the httpbin.org egress**: every non-download `waf-session` request fetches `https://httpbin.org/get` from page context to learn Accept-Language (`wafSession.js:68-82`) — an undocumented third-party runtime dependency that leaks egress IP/usage timing and adds latency/failure modes. Derive locally: `page.evaluate(() => navigator.languages.join(','))` (or an env/static value).
- `app.disable('x-powered-by')`; optionally scope CORS to known origins instead of open `cors()` (`index.js:25`) — for a token-authed server-to-server API, CORS scoping is cosmetic but harmless.

## Phase 4 - CI/CD, docs, optional

- **[.github/workflows/check_test.yaml](.github/workflows/check_test.yaml)**: use `npm ci` (currently `npm install` — can drift from the lockfile); pin `actions/checkout` / `actions/setup-node` to commit SHAs.
- **[.github/workflows/docker_hub.yaml](.github/workflows/docker_hub.yaml)**: uses ancient `@v2` actions and pushes `zfcsoftware/cf-clearance-scraper` with Docker Hub creds on push to `main` — on this fork it should be disabled or retargeted; decide and act.
- **[README.md](README.md)**: quick-start currently shows an unauthenticated, all-interfaces `docker run -p 3000:3000`; align with the hardened path (`authToken` required, `-p 127.0.0.1:3000:3000` or the compose file).
- **SSRF allowlist (optional, gated on threat model)**: `url` is validated only as `format: "uri"` (`reqValidate.js:24-27`) — `file://`, `chrome://`, and internal/metadata hosts all pass straight to `page.goto`. SSRF is by-design for the authenticated operator; if untrusted callers ever gain access, restrict schemes to http/https and block private/link-local/metadata ranges pre-goto.
- **Health (optional)**: minimal unauthenticated `GET /health` (readiness = `global.browser` truthy) + Docker `HEALTHCHECK`; keep it response-static so it leaks nothing.

## Already solid (no action)

Per-request isolated browser contexts with close-on-success/timeout/error; concurrency gate (`browserLimit` → 429) with no counter-leak path; static Chromium launch args (no user input reaches them); no `child_process`/`eval`/dynamic requires; verbose logging redacts values (cookie names, header keys, token length only); `.env`/keys gitignored + dockerignored; `.npmrc` `min-release-age=30`; full lockfile committed.

## Verification (at implementation time)

- `npm test` green after Phase 0 (existing validate tests unaffected; add none unless requested).
- `curl` checks: request with `download` field → 400; `waf-session` returns `{ cookies, headers }` only; missing/wrong token → 401 **before** any schema detail; `NODE_ENV=production` boot without `authToken` → exit 1.
- `docker compose up --build` succeeds on a machine with **no GitHub SSH keys** (git+https pin), as non-root, with `read_only` on — and still solves a live challenge through the tunnel.
- `docker inspect` confirms `no-new-privileges`, dropped caps, pids/mem limits, tmpfs mounts.
- No outbound `httpbin.org` traffic during a `waf-session` request.
