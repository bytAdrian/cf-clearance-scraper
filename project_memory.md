# cf-clearance-scraper — Project Memory

## Deployment (Raspberry Pi 5, aarch64)

- Lives at `~/docker/cf-clearance-scraper`, runs via Docker Compose (pattern matches `~/docker/n8n`).
- Container binds to `127.0.0.1:3000` only. External access goes through the existing Cloudflare Tunnel (`cloudflared`, dashboard-managed token install).
- Build/run: `docker compose up -d --build`
- Logs: `docker logs -f cf-clearance-scraper`
- Hardened container: runs as non-root `node` user, `read_only` rootfs with a sized tmpfs on `/tmp` (Chromium/Xvfb scratch; `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` point there), `cap_drop: ALL`, `no-new-privileges`, `pids_limit`, `mem_limit`, `init: true`, dedicated compose network `172.28.0.0/24` (gateway `172.28.0.1`).
- `CHROME_NO_SANDBOX=true` is set in `docker-compose.yml` (adds `--no-sandbox --disable-dev-shm-usage`) — Chromium's own sandbox doesn't work unprivileged in the container. Native (non-Docker) runs keep the sandbox by leaving that env unset.
- `CHROME_PATH=/usr/bin/chromium` is set in the Dockerfile — `chrome-launcher` (used by `@bytadrian/puppeteer-real-browser`) reads `CHROME_PATH`, not `CHROME_BIN`.
- Base image is digest-pinned to the current Node 24 LTS patch; bump via `docker buildx imagetools inspect node:24-bookworm`.
- `@bytadrian/puppeteer-real-browser` is commit-pinned in `package.json` (`github:bytAdrian/puppeteer-real-browser#<sha>`, lockfile resolves over `git+https` — no SSH keys needed to build). Upgrading it = push to the fork, paste the new commit SHA into `package.json`, `npm install --package-lock-only`.
- Healthcheck: unauthenticated `GET /health` → `200 {status:"ok"}` when the browser is up, `503 {status:"starting"}` otherwise; wired into the compose `healthcheck`.

## Env vars (`.env`, chmod 600, gitignored + dockerignored)

| Var | Purpose |
|---|---|
| `authToken` | Static API token. Random 64-hex generated with `openssl rand -hex 32`. **Required in production** — the server exits at startup if `NODE_ENV=production` and it is unset. Compared timing-safe. |
| `trustedProxyCidr` | Comma-separated IPs/CIDRs whose forwarded headers are trusted (Express `trust proxy`). In compose this is the network gateway `172.28.0.1`. Unset = forwarded headers untrusted. Replaces the old blanket `trustProxy` flag (which now only logs a warning). |
| `allowedIps` | Optional comma-separated client IP allowlist, exact match (403 otherwise). Empty/unset = allow all (token still required). Needs `trustedProxyCidr` to see real client IPs behind the tunnel. |
| `corsOrigins` | Optional comma-separated CORS origin allowlist. Unset = open CORS (server-to-server API; cosmetic). |
| `browserLimit` | Max concurrent browser contexts (10 on the Pi). |
| `timeOut` | Request timeout ms (60000). |
| `DETAILED_LOGS` | `true` → verbose `[waf-session]` etc. logs (sanitized; no cookie/token/password values). |

## API

`POST /cf-clearance-scraper` — token via `Authorization: Bearer <token>` header **or** body `authToken`.

Guard order: 401 (auth) → 403 (IP allowlist) → 400 (schema) → 429 (browser limit). 500 errors return a generic `"Request failed"` (details go to server logs); only internal control-flow messages (`Timeout Error`, etc.) pass through.

### Modes
`source` | `turnstile-min` | `turnstile-max` | `waf-session` — JSON responses.

**Download capture was removed** (2026-07): the service only returns session data (cookies/headers/tokens/page source). The schema uses `additionalProperties: false`, so any request still sending a `download` field gets a **400**.

## Curl examples

```bash
# JSON waf-session (LAN)
curl -X POST http://127.0.0.1:3000/cf-clearance-scraper \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url":"https://nopecha.com/demo/cloudflare","mode":"waf-session"}'

# Hosted (through Cloudflare Tunnel)
curl -X POST https://<hostname>.adrianbytyqi.com/cf-clearance-scraper \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url":"https://nopecha.com/demo/cloudflare","mode":"waf-session"}'

# Health
curl http://127.0.0.1:3000/health
```

## External access

- Cloudflare Zero Trust → Networks → Tunnels → (existing tunnel) → Public Hostname → add `<hostname>.adrianbytyqi.com` → service `http://localhost:3000`.
- **Cloudflare caps proxied requests at ~100 s** — for longer-running requests use the WireGuard path: `http://10.127.255.1:3000` (no CF in between).
- No router port-forwarding needed; nothing new listens on public interfaces.

## Constraints / notes

- Static token + optional IP allowlist by design (no per-client token storage).
- `waf-session` derives Accept-Language locally from `navigator.languages` — no external calls (the old per-request `httpbin.org` probe is gone).
- Pi: 16 GB RAM; `browserLimit=10` and `mem_limit: 4g` are conservative headroom alongside n8n/postgres.
- CI: `check_test.yaml` uses `npm ci` and SHA-pinned actions; the upstream Docker Hub publish workflow was removed from this fork.
