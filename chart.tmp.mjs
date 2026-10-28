import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const SP = '/tmp/claude-1001/-home-niels/20cfcac7-066f-4a46-be2b-e7735e6cc68a/scratchpad'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1100, height: 760 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.route('**/api/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"sub":"me","name":"Dig","picture":null,"groupUrl":null}' }))
await p.route('**/api/archive', r => r.fulfill({ status: 200, contentType: 'application/json', body: readFileSync('tests/fixtures/archive.json', 'utf8') }))
await p.route('**/tex/**', async r => {
  const n = (r.request().url().match(/(\d+)\.(png|jpg)/) || [,'1'])[1]
  const hue = (Number(n) * 47) % 360
  await r.fulfill({ status: 200, contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue} 55% 45%)"/><text x="32" y="40" font-size="26" fill="#fff" text-anchor="middle">${n}</text></svg>` })
})
await p.goto('http://[::1]:5199/index.html', { waitUntil: 'networkidle' })
await p.waitForSelector('.columns', { timeout: 30000 })
const koen = p.locator('.columns.lying')
const box = await koen.boundingBox()
console.log('Køn section height:', Math.round(box.height), 'px (was 1581)')
console.log('bars:', await koen.locator('.blabel').allTextContents())
await koen.scrollIntoViewIfNeeded()
await p.waitForTimeout(300)
await koen.screenshot({ path: `${SP}/koen.png` })
// Scrolled along: the names must still be there.
await koen.evaluate(el => { el.scrollLeft = 1400 })
await p.waitForTimeout(300)
await koen.screenshot({ path: `${SP}/koen-scrolled.png` })
console.log('scrollWidth/clientWidth:', await koen.evaluate(el => `${el.scrollWidth}/${el.clientWidth}`))
console.log('errors:', errs.length ? errs : 'none')
await b.close()
