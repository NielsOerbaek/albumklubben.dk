import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { openDb } from '../../server/db.ts'
import { ICON_FILES, safeNext } from '../../server/theta-auth.ts'
import { tmp } from '../tmp.ts'

const ISSUER = 'https://theta.test/oidc'
const GROUP = '122304557724776'

/** A fake Theta: discovery, the token endpoint and userinfo, recording what it was asked. */
function fakeTheta(groups: { id: string }[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: typeof globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (url.endsWith('/.well-known/openid-configuration')) {
      return json({
        authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/me`, end_session_endpoint: `${ISSUER}/logout`,
      })
    }
    if (url === `${ISSUER}/token`) return json({ access_token: 'at', id_token: 'id-token-1', token_type: 'Bearer' })
    if (url === `${ISSUER}/me`) return json({ sub: 'sub-1', name: 'Kim', groups })
    return json({}, 404)
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

function setup(groups: { id: string }[] = [{ id: GROUP }]) {
  const theta = fakeTheta(groups)
  const app = buildApp({
    db: openDb(':memory:'),
    uploadDir: tmp('auth-'),
    adminPassword: 'hemmelig',
    sessionSecret: 'secret',
    theta: { issuer: ISSUER, clientId: 'albumklubben', clientSecret: 's3cret', groupId: GROUP, publicUrl: 'https://ak.test', fetch: theta.fetch },
  })
  return { app, theta }
}

const cookieHeader = (res: { cookies: { name: string; value: string }[] }, name: string) => {
  const c = res.cookies.find(x => x.name === name)
  return c ? `${name}=${c.value}` : ''
}

async function signIn(app: ReturnType<typeof setup>['app'], next = '/klubhuset') {
  const start = await app.inject({ url: `/auth/login?next=${encodeURIComponent(next)}` })
  const state = new URL(start.headers.location as string).searchParams.get('state')!
  const cb = await app.inject({ url: `/auth/callback?code=c1&state=${state}`, headers: { cookie: cookieHeader(start, 'ak_oidc') } })
  return { start, cb }
}

describe('Log ind med Theta', () => {
  it('lets nobody in without a session: pages show the login page, everything else is 401', async () => {
    const { app } = setup()
    const page = await app.inject({ url: '/klubhuset', headers: { accept: 'text/html' } })
    expect(page.statusCode).toBe(401)
    expect(page.headers['content-type']).toContain('text/html')
    // The login page at the address that was asked for, with the way back in the button.
    expect(page.body).toContain('Log ind med Theta')
    expect(page.body).toContain('href="/auth/login?next=%2Fklubhuset"')
    expect(page.body).toContain('Kun for medlemmer af klubbens gruppe på Theta')
    for (const url of ['/api/archive', '/uploads/posters/x.jpg', '/tex/x.png', '/admin']) {
      expect((await app.inject({ url })).statusCode, url).toBe(401)
    }
    expect((await app.inject({ method: 'POST', url: '/admin/login', payload: {} })).statusCode).toBe(401)
    expect((await app.inject({ url: '/healthz' })).body).toBe('ok')
  })

  it('gives an unfurler the login page, because that is all a link can ever unfold into', async () => {
    const { app } = setup()
    // Slack, Theta and the rest ask with `Accept: */*` and no Sec-Fetch-Mode. Asking for HTML
    // was the old test, and it meant a pasted link unfolded into twenty-four bytes of plain text.
    const res = await app.inject({ url: '/', headers: { accept: '*/*', 'user-agent': 'Slackbot-LinkExpanding 1.0' } })
    expect(res.statusCode).toBe(401)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('<meta property="og:title" content="Albumklubben">')
    expect(res.body).toContain('<meta property="og:image" content="https://ak.test/icon-512.png">')
    expect(res.body).toContain('<meta name="twitter:card" content="summary">')
    expect(res.body).toContain('Kun for medlemmer af klubbens gruppe på Theta.')
    // The card says what this is and who it is for, and nothing about who or what is inside.
    expect(res.body).not.toMatch(/lyttefest|opslagstavle|Kate Bush/i)
  })

  it('keeps the preview off search, which is a different thing from a shared link', async () => {
    const res = await setup().app.inject({ url: '/', headers: { accept: '*/*' } })
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow">')
  })

  it('names itself once, not twice', async () => {
    const res = await setup().app.inject({ url: '/', headers: { accept: '*/*' } })
    expect(res.body).toContain('<title>Albumklubben</title>')
    // Other pages outside the gate still say which one they are.
    const gone = await setup().app.inject({ url: '/auth/callback?error=denied&state=x' })
    expect(gone.body).toContain('· Albumklubben</title>')
  })

  it('still answers data and files with a line of text, not with a page', async () => {
    const { app } = setup()
    for (const [url, headers] of [
      ['/api/archive', {}],
      ['/api/lyttefester', { accept: '*/*' }],
      ['/uploads/posters/x.jpg', { accept: '*/*' }],
      ['/tex/128/covers/1.png', { accept: '*/*' }],
      ['/klubhuset', { accept: 'application/json' }],
    ] as [string, Record<string, string>][]) {
      const res = await app.inject({ url, headers })
      expect(res.statusCode, url).toBe(401)
      expect(res.headers['content-type'], url).not.toContain('text/html')
      expect(res.body, url).toBe('Log ind med Theta først')
    }
  })

  it('does not hand a page to a POST that has no session', async () => {
    const res = await setup().app.inject({ method: 'POST', url: '/api/lyttefest', payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.headers['content-type']).not.toContain('text/html')
  })

  it('sends the person to Theta with PKCE, the groups scope and our callback', async () => {
    const { app } = setup()
    const res = await app.inject({ url: '/auth/login?next=/klubhuset' })
    const url = new URL(res.headers.location as string)
    expect(url.origin + url.pathname).toBe(`${ISSUER}/auth`)
    expect(url.searchParams.get('client_id')).toBe('albumklubben')
    expect(url.searchParams.get('redirect_uri')).toBe('https://ak.test/auth/callback')
    expect(url.searchParams.get('scope')).toBe('openid profile groups feed posts')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('lets a member of the group in and back to where they were going', async () => {
    const { app, theta } = setup()
    const { cb } = await signIn(app, '/klubhuset')
    expect(cb.statusCode).toBe(302)
    expect(cb.headers.location).toBe('/klubhuset')
    const token = theta.calls.find(c => c.url === `${ISSUER}/token`)!
    expect((token.init!.headers as Record<string, string>).authorization)
      .toBe(`Basic ${Buffer.from('albumklubben:s3cret').toString('base64')}`)
    expect(String(token.init!.body)).toContain('code_verifier=')
    const api = await app.inject({ url: '/api/archive', headers: { cookie: cookieHeader(cb, 'ak_member') } })
    expect(api.statusCode).toBe(200)
  })

  it('turns away someone who is not in the group, and sets no session', async () => {
    const { app } = setup([{ id: '999' }])
    const { cb } = await signIn(app)
    expect(cb.statusCode).toBe(403)
    expect(cb.body).toContain('Kun for medlemmer')
    expect(cb.cookies.find(c => c.name === 'ak_member')).toBeUndefined()
  })

  it('refuses a callback whose state does not match the browser that started it', async () => {
    const { app, theta } = setup()
    const start = await app.inject({ url: '/auth/login' })
    const cb = await app.inject({ url: '/auth/callback?code=c1&state=forged', headers: { cookie: cookieHeader(start, 'ak_oidc') } })
    expect(cb.statusCode).toBe(400)
    expect(theta.calls.some(c => c.url === `${ISSUER}/token`)).toBe(false)
    const noCookie = await app.inject({ url: '/auth/callback?code=c1&state=x' })
    expect(noCookie.statusCode).toBe(400)
  })

  it('does not accept a forged or tampered session cookie', async () => {
    const { app } = setup()
    const forged = `ak_member=${encodeURIComponent(JSON.stringify({ sub: 'x', name: '', exp: 9e9 }))}`
    expect((await app.inject({ url: '/api/archive', headers: { cookie: forged } })).statusCode).toBe(401)
  })

  it('logs out here and sends the person on to Theta to end the session there too', async () => {
    const { app } = setup()
    const { cb } = await signIn(app)
    const out = await app.inject({ url: '/auth/logout', headers: { cookie: cookieHeader(cb, 'ak_member') } })
    expect(out.statusCode).toBe(302)
    expect(out.cookies.find(c => c.name === 'ak_member')?.value).toBe('')
    const url = new URL(out.headers.location as string)
    expect(url.origin + url.pathname).toBe(`${ISSUER}/logout`)
    expect(url.searchParams.get('id_token_hint')).toBe('id-token-1')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://ak.test/auth/logged-out')
  })

  it('logs out without Theta when there is no session to end there', async () => {
    const { app } = setup()
    const out = await app.inject({ url: '/auth/logout' })
    expect(out.statusCode).toBe(302)
    expect(out.headers.location).toBe('/auth/logged-out')
  })

  it('says plainly on the way out that Theta still knows who you are', async () => {
    const { app } = setup()
    const done = await app.inject({ url: '/auth/logged-out' })
    expect(done.statusCode).toBe(200)
    expect(done.body).toContain('Du er logget ud af Albumklubben')
    expect(done.body).toContain('Du er stadig logget ind på Theta i denne browser')
    expect(done.body).toContain('href="https://theta.test"')
    expect(done.body).toContain('Log ind med Theta')
  })

  it('serves the icon and the manifest without a login, and nothing else', async () => {
    const { app } = setup()
    // Without a web directory these are 404s, but the point is that the gate lets them past.
    for (const path of ICON_FILES) {
      expect((await app.inject({ url: path })).statusCode, path).toBe(404)
    }
    for (const path of ['/icon-256.png', '/manifest.json', '/web/public/icon.svg', '/']) {
      expect((await app.inject({ url: path })).statusCode, path).toBe(401)
    }
  })

  it('shows the icon on the pages outside the gate', async () => {
    const { app } = setup()
    const page = await app.inject({ url: '/', headers: { accept: 'text/html' } })
    expect(page.body).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml">')
    expect(page.body).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(page.body).toContain('src="/icon.svg"')
  })

  it('only follows a next that stays on this site', () => {
    expect(safeNext('/klubhuset?x=1#kortet')).toBe('/klubhuset?x=1#kortet')
    // Browsers drop tabs and newlines, so /\t/evil.test would be //evil.test.
    for (const bad of ['//evil.test', '/\\evil.test', '/\t/evil.test', '/\n/evil.test', 'https://evil.test', undefined, 42]) {
      expect(safeNext(bad), String(bad)).toBe('/')
    }
  })

  it('does not take a member\'s or a sign-in cookie as the admin cookie', async () => {
    const { app } = setup()
    const { start, cb } = await signIn(app)
    for (const value of [cb.cookies.find(c => c.name === 'ak_member')!.value, start.cookies.find(c => c.name === 'ak_oidc')!.value]) {
      const res = await app.inject({ url: '/admin', headers: { cookie: `${cookieHeader(cb, 'ak_member')}; ak_admin=${value}` } })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/admin/login')
    }
  })
})
