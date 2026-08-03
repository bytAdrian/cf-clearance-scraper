const express = require('express')
const app = express()
const port = process.env.PORT || 3000
const bodyParser = require('body-parser')
const crypto = require('crypto')
const authToken = process.env.authToken || null
const cors = require('cors')
const reqValidate = require('./module/reqValidate')

if (process.env.NODE_ENV === 'production' && !authToken) {
    console.error('FATAL: authToken is not set. Production refuses to start without API authentication — set authToken in the environment (.env).')
    process.exit(1)
}

global.browserLength = 0
global.browserLimit = Number(process.env.browserLimit) || 20
global.timeOut = Number(process.env.timeOut || 60000)
const cliArgs = new Set(process.argv.slice(2).map((arg) => String(arg || '').toLowerCase()))
const isDetailedLogsEnvEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.DETAILED_LOGS || '').toLowerCase())
global.detailedLogs = cliArgs.has('--verbose') || cliArgs.has('--debug') || isDetailedLogsEnvEnabled

const isEnvFlagEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())
const allowedIps = String(process.env.allowedIps || '').split(',').map((ip) => ip.trim()).filter(Boolean)

// Forwarded headers are only trusted from the configured proxy addresses/CIDRs — a blanket
// value would let anything that reaches the port spoof X-Forwarded-For past allowedIps.
const trustedProxyCidr = String(process.env.trustedProxyCidr || '').split(',').map((entry) => entry.trim()).filter(Boolean)
if (trustedProxyCidr.length) app.set('trust proxy', trustedProxyCidr)
else if (isEnvFlagEnabled(process.env.trustProxy)) console.warn('trustProxy is set but trustedProxyCidr is not; forwarded headers stay untrusted. Set trustedProxyCidr to the proxy address/CIDR (in Docker: the compose network gateway, e.g. 172.28.0.1).')

app.disable('x-powered-by')
app.use(bodyParser.json({ limit: '50kb' }))
app.use(bodyParser.urlencoded({ extended: true, limit: '50kb' }))
const corsOrigins = String(process.env.corsOrigins || '').split(',').map((origin) => origin.trim()).filter(Boolean)
app.use(corsOrigins.length ? cors({ origin: corsOrigins }) : cors())
if (process.env.NODE_ENV !== 'development') {
    let server = app.listen(port, () => { console.log(`Server running on port ${port}`) })
    try {
        server.timeout = global.timeOut
    } catch (e) { }
}
if (process.env.SKIP_LAUNCH != 'true') require('./module/createBrowser')

const getSource = require('./endpoints/getSource')
const solveTurnstileMin = require('./endpoints/solveTurnstile.min')
const solveTurnstileMax = require('./endpoints/solveTurnstile.max')
const wafSession = require('./endpoints/wafSession')

function getRequestToken(req) {
    const header = String(req.headers['authorization'] || '')
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
    return req.body?.authToken ?? null
}

// Hashing both sides gives equal-length buffers, which timingSafeEqual requires.
function isTokenValid(provided) {
    if (typeof provided !== 'string' || !provided) return false
    const expected = crypto.createHash('sha256').update(authToken).digest()
    const actual = crypto.createHash('sha256').update(provided).digest()
    return crypto.timingSafeEqual(actual, expected)
}

function normalizeIp(ip) {
    const value = String(ip || '')
    return value.startsWith('::ffff:') ? value.slice(7) : value
}

// Internal control-flow messages that are safe to echo to clients. Anything else
// (puppeteer/proxy/navigation internals) is logged server-side and returned generically.
const SAFE_CLIENT_ERRORS = new Set(['Timeout Error', 'Missing url parameter', 'Failed to create browser context'])
function toClientError(mode, err) {
    const message = err?.message || String(err)
    console.error(`[${mode}] request failed:`, message)
    return { code: 500, message: SAFE_CLIENT_ERRORS.has(message) ? message : 'Request failed' }
}

app.post('/cf-clearance-scraper', async (req, res) => {

    const data = req.body

    if (authToken && !isTokenValid(getRequestToken(req))) return res.status(401).json({ code: 401, message: 'Unauthorized' })

    if (allowedIps.length && !allowedIps.includes(normalizeIp(req.ip))) return res.status(403).json({ code: 403, message: 'Forbidden' })

    const check = reqValidate(data)

    if (check !== true) return res.status(400).json({ code: 400, message: 'Bad Request', schema: check })

    if (global.browserLength >= global.browserLimit) return res.status(429).json({ code: 429, message: 'Too Many Requests' })

    if (process.env.SKIP_LAUNCH != 'true' && !global.browser) return res.status(500).json({ code: 500, message: 'The scanner is not ready yet. Please try again a little later.' })

    var result = { code: 500 }

    global.browserLength++

    switch (data.mode) {
        case "source":
            result = await getSource(data).then(res => { return { source: res, code: 200 } }).catch(err => toClientError('source', err))
            break;
        case "turnstile-min":
            result = await solveTurnstileMin(data).then(res => { return { token: res, code: 200 } }).catch(err => toClientError('turnstile-min', err))
            break;
        case "turnstile-max":
            result = await solveTurnstileMax(data).then(res => { return { token: res, code: 200 } }).catch(err => toClientError('turnstile-max', err))
            break;
        case "waf-session":
            result = await wafSession(data).then(res => { return { ...res, code: 200 } }).catch(err => toClientError('waf-session', err))
            break;
    }

    global.browserLength--

    res.status(result.code ?? 500).send(result)
})

app.get('/health', (req, res) => {
    if (process.env.SKIP_LAUNCH != 'true' && !global.browser) return res.status(503).json({ code: 503, status: 'starting' })
    res.status(200).json({ code: 200, status: 'ok' })
})

app.use((req, res) => { res.status(404).json({ code: 404, message: 'Not Found' }) })

if (process.env.NODE_ENV == 'development') module.exports = app
