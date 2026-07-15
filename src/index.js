const express = require('express')
const app = express()
const port = process.env.PORT || 3000
const bodyParser = require('body-parser')
const fs = require('fs')
const path = require('path')
const authToken = process.env.authToken || null
const cors = require('cors')
const reqValidate = require('./module/reqValidate')

global.browserLength = 0
global.browserLimit = Number(process.env.browserLimit) || 20
global.timeOut = Number(process.env.timeOut || 60000)
const cliArgs = new Set(process.argv.slice(2).map((arg) => String(arg || '').toLowerCase()))
const isDetailedLogsEnvEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.DETAILED_LOGS || '').toLowerCase())
global.detailedLogs = cliArgs.has('--verbose') || cliArgs.has('--debug') || isDetailedLogsEnvEnabled

const isEnvFlagEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())
const allowedIps = String(process.env.allowedIps || '').split(',').map((ip) => ip.trim()).filter(Boolean)

if (isEnvFlagEnabled(process.env.trustProxy)) app.set('trust proxy', 1)

app.use(bodyParser.json({}))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())
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

function normalizeIp(ip) {
    const value = String(ip || '')
    return value.startsWith('::ffff:') ? value.slice(7) : value
}

function sendDownloadFile(res, file) {
    let cleaned = false
    const cleanup = () => {
        if (cleaned) return
        cleaned = true
        if (file.tmpDir) fs.rm(file.tmpDir, { recursive: true, force: true }, () => { })
    }

    try {
        const safeName = String(file.filename || 'download').replace(/[\r\n"\\/]+/g, '_').replace(/[^\x20-\x7E]+/g, '_').slice(0, 200) || 'download'

        if (file.contentType) res.type(file.contentType)
        else res.type(path.extname(safeName) || 'bin')

        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
        res.setHeader('X-Download-Filename', encodeURIComponent(file.filename || safeName))
        if (Number.isFinite(file.size)) {
            res.setHeader('Content-Length', String(file.size))
            res.setHeader('X-Download-Size', String(file.size))
        }

        res.status(200)
        res.on('close', cleanup)

        const stream = fs.createReadStream(file.path)
        stream.on('error', (err) => {
            cleanup()
            if (!res.headersSent) res.status(500).json({ code: 500, message: err.message })
            else res.destroy(err)
        })
        stream.pipe(res)
    } catch (err) {
        cleanup()
        if (!res.headersSent) res.status(500).json({ code: 500, message: err.message })
    }
}


app.post('/cf-clearance-scraper', async (req, res) => {

    const data = req.body

    const check = reqValidate(data)

    if (check !== true) return res.status(400).json({ code: 400, message: 'Bad Request', schema: check })

    if (authToken && getRequestToken(req) !== authToken) return res.status(401).json({ code: 401, message: 'Unauthorized' })

    if (allowedIps.length && !allowedIps.includes(normalizeIp(req.ip))) return res.status(403).json({ code: 403, message: 'Forbidden' })

    if (global.browserLength >= global.browserLimit) return res.status(429).json({ code: 429, message: 'Too Many Requests' })

    if (process.env.SKIP_LAUNCH != 'true' && !global.browser) return res.status(500).json({ code: 500, message: 'The scanner is not ready yet. Please try again a little later.' })

    const isDownload = data.download?.enabled === true
    if (isDownload) {
        const downloadTimeout = data.download.timeout || 120000
        try {
            req.setTimeout(downloadTimeout + 30000)
            res.setTimeout(downloadTimeout + 30000)
        } catch (e) { }
    }

    var result = { code: 500 }

    global.browserLength++

    switch (data.mode) {
        case "source":
            result = await getSource(data).then(res => { return { source: res, code: 200 } }).catch(err => { return { code: 500, message: err?.message || String(err) } })
            break;
        case "turnstile-min":
            result = await solveTurnstileMin(data).then(res => { return { token: res, code: 200 } }).catch(err => { return { code: 500, message: err?.message || String(err) } })
            break;
        case "turnstile-max":
            result = await solveTurnstileMax(data).then(res => { return { token: res, code: 200 } }).catch(err => { return { code: 500, message: err?.message || String(err) } })
            break;
        case "waf-session":
            result = await wafSession(data).then(res => { return { ...res, code: 200 } }).catch(err => { return { code: 500, message: err?.message || String(err) } })
            break;
    }

    global.browserLength--

    if (result.code === 200 && result.file) return sendDownloadFile(res, result.file)

    res.status(result.code ?? 500).send(result)
})

app.use((req, res) => { res.status(404).json({ code: 404, message: 'Not Found' }) })

if (process.env.NODE_ENV == 'development') module.exports = app
