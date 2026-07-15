# cf-clearance-scraper — Project Memory

## Deployment (Raspberry Pi 5, aarch64)

- Lives at `~/docker/cf-clearance-scraper`, runs via Docker Compose (pattern matches `~/docker/n8n`).
- Container binds to `127.0.0.1:3000` only. External access goes through the existing Cloudflare Tunnel (`cloudflared`, dashboard-managed token install).
- Build/run: `docker compose up -d --build`
- Logs: `docker logs -f cf-clearance-scraper`
- Chromium runs inside the container as root, so `CHROME_NO_SANDBOX=true` is set in `docker-compose.yml` (adds `--no-sandbox --disable-dev-shm-usage`). Native (non-Docker) runs keep the sandbox by leaving that env unset.
- `CHROME_PATH=/usr/bin/chromium` is set in the Dockerfile — `chrome-launcher` (used by `@bytadrian/puppeteer-real-browser`) reads `CHROME_PATH`, not `CHROME_BIN`.

## Env vars (`.env`, chmod 600, gitignored + dockerignored)

| Var | Purpose |
|---|---|
| `authToken` | Static API token. Random 64-hex generated with `openssl rand -hex 32`. |
| `trustProxy` | `true` → `app.set('trust proxy', 1)` so `req.ip` is the real client IP behind cloudflared/nginx. |
| `allowedIps` | Optional comma-separated client IP allowlist (403 otherwise). Empty/unset = allow all (token still required). |
| `browserLimit` | Max concurrent browser contexts (10 on the Pi). |
| `timeOut` | Default request timeout ms (60000). Download requests use `download.timeout` instead. |
| `DETAILED_LOGS` | `true` → verbose `[waf-session]` etc. logs (sanitized; no cookie/token/password values). |

## API

`POST /cf-clearance-scraper` — token via `Authorization: Bearer <token>` header **or** body `authToken`.

### Modes
`source` | `turnstile-min` | `turnstile-max` | `waf-session` — unchanged JSON responses.

### Download capture (waf-session)

```json
{
  "url": "https://example.com/specific/download/link",
  "mode": "waf-session",
  "download": {
    "enabled": true,
    "timeout": 90000,
    "clickSelector": "optional-css-selector-if-a-click-is-needed"
  },
  "proxy": { "host": "1.2.3.4", "port": 5837, "username": "u", "password": "p" }
}
```

- `download.timeout`: 5000–300000 ms (default 120000). Server socket timeout is extended per-request to `timeout + 30s`.
- Response is the raw file bytes with `Content-Type` (derived from filename extension), `Content-Disposition`, `Content-Length`, `X-Download-Filename`, `X-Download-Size`.
- Direct download links abort navigation with `net::ERR_ABORTED` — this is expected and tolerated.
- On timeout: `{ "code": 500, "message": "Download timed out" }`.
- Temp files go to `mkdtemp(os.tmpdir()/cfcs-dl-*)` and are deleted after the response (or on failure).
- Capture mechanism: CDP `Browser.setDownloadBehavior` (`allowAndName`, scoped to the request's browser context) + `Browser.downloadWillBegin`/`downloadProgress` events.

## Curl examples

```bash
# JSON waf-session (LAN)
curl -X POST http://127.0.0.1:3000/cf-clearance-scraper \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url":"https://nopecha.com/demo/cloudflare","mode":"waf-session"}'

# Download capture -> file on disk
curl -X POST http://127.0.0.1:3000/cf-clearance-scraper \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url":"https://example.com/file.zip","mode":"waf-session","download":{"enabled":true,"timeout":90000}}' \
  --output downloaded-file.zip

# Hosted (through Cloudflare Tunnel)
curl -X POST https://<hostname>.adrianbytyqi.com/cf-clearance-scraper \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url":"https://example.com/file.zip","mode":"waf-session","download":{"enabled":true,"timeout":90000}}' \
  --output downloaded-file.zip
```

## External access

- Cloudflare Zero Trust → Networks → Tunnels → (existing tunnel) → Public Hostname → add `<hostname>.adrianbytyqi.com` → service `http://localhost:3000`.
- **Cloudflare caps proxied requests at ~100 s** — keep `download.timeout` ≤ 90000 through the tunnel. For longer downloads use the WireGuard path: `http://10.127.255.1:3000` (no CF in between, no cap beyond `timeout + 30s`).
- No router port-forwarding needed; nothing new listens on public interfaces.

## Constraints / notes

- Static token + optional IP allowlist by design (no per-client token storage).
- `waf-session` (non-download) calls `https://httpbin.org/get` once per request for Accept-Language.
- Pi: 16 GB RAM; `browserLimit=10` is conservative headroom alongside n8n/postgres.
