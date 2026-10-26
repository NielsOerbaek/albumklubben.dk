// Smoke test against the public site. Usage: node tools/smoke.mjs [baseUrl]
// Basic auth comes from SITE_USER/SITE_PASSWORD in the live .env; screenshots go to var/screens/task10/.
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import sharp from 'sharp'

const ENV = process.env.SMOKE_ENV ?? '/home/theta/albumklubben-live/.env'
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const base = process.argv[2] ?? 'https://albumklubben.dn.osogdata.dk'
const out = process.env.SMOKE_OUT ?? new URL('../var/screens/task10/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const pages = [
  ['front', '/'],
  ['front-kortet', '/#kortet'],
  ['front-tal', '/#tal'],
  ['klubhuset', '/klubhuset', true],
  ['admin-login', '/admin/login'],
]

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({
  httpCredentials: { username: env.SITE_USER, password: env.SITE_PASSWORD },
  viewport: { width: 1280, height: 800 },
})
let failed = 0
// Old addresses: the museum lands on the Klubhuset, Arkivet on the front page.
for (const [from, to] of [['/museum', '/klubhuset'], ['/arkiv', '/']]) {
  const page = await ctx.newPage()
  await page.goto(base + from, { waitUntil: 'domcontentloaded' })
  const ok = new URL(page.url()).pathname === to
  console.log(ok ? `ok   ${from} -> ${to}` : `FAIL ${from} landed on ${page.url()}`)
  failed += ok ? 0 : 1
  await page.close()
}
for (const [name, path, walk] of pages) {
  const page = await ctx.newPage()
  const problems = []
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()}: ${r.url()}`))
  await page.goto(base + path, { waitUntil: 'networkidle' })
  if (walk) {
    await page.waitForTimeout(1500)
    await page.locator('canvas').first().click()
    await page.keyboard.down('w')
    await page.waitForTimeout(1000)
    await page.keyboard.up('w')
  }
  const shot = await page.screenshot({ path: `${out}${name}.png` })
  if (walk) {
    const { channels } = await sharp(shot).stats()
    const variance = Math.max(...channels.map((c) => c.stdev)) ** 2
    if (!(variance > 0)) problems.push('screenshot is one flat colour')
  }
  console.log(problems.length ? `FAIL ${path}\n  ${problems.join('\n  ')}` : `ok   ${path}`)
  failed += problems.length ? 1 : 0
  await page.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
