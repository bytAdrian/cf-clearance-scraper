process.env.NODE_ENV = 'development'

const app = require('../src/app')()
const browserManager = require('../src/browser/browserManager')
const request = require("supertest")

beforeAll(async () => {
    await browserManager.start()
    while (!browserManager.isReady()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}, 30000);


afterAll(async () => {
    await browserManager.shutdown()
})


test('Scraping Page Source from Cloudflare Protection', async () => {
    return request(app)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "source"
        })
        .expect(200)
        .then(response => { expect(response.body.code).toEqual(200); })
}, 60000)


test('Creating a Turnstile Token With Site Key [min]', async () => {
    return request(app)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://turnstile.zeroclover.io/',
            siteKey: "0x4AAAAAAAEwzhD6pyKkgXC0",
            mode: "turnstile-min"
        })
        .expect(200)
        .then(response => { expect(response.body.code).toEqual(200); })
}, 60000)

test('Creating a Turnstile Token With Site Key [max]', async () => {
    return request(app)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://turnstile.zeroclover.io/',
            mode: "turnstile-max"
        })
        .expect(200)
        .then(response => { expect(response.body.code).toEqual(200); })
}, 60000)

test('Create Cloudflare WAF Session', async () => {
    return request(app)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "waf-session"
        })
        .expect(200)
        .then(response => { expect(response.body.code).toEqual(200); })
}, 60000)
