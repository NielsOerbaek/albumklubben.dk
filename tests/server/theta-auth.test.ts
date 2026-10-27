import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { openDb } from '../../server/db.ts'
import { safeNext } from '../../server/theta-auth.ts'

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
      return json({ authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/me` })
    }
    if (url === `${ISSUER}/token`) return json({ access_token: 'at', token_type: 'Bearer' })
    if (url === `${ISSUER}/me`) return json({ sub: 'sub-1', name: 'Kim', groups })
    return json({}, 404)
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

function setup(groups: { id: string }[] = [{ id: GROUP }]) {
  const theta = fakeTheta(groups)
  const app = buildApp({
    db: openDb(':memory:'),
    uploadDir: mkdtempSync(join(tmpdir(), 'auth-')),
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
  it('lets nobody in without a session: pages redirect to the sign-in, everything else is 401', async () => {
    const { app } = setup()
    const page = await app.inject({ url: '/klubhuset', headers: { accept: 'text/html' } })
    expect(page.statusCode).toBe(302)
    expect(page.headers.location).toBe('/auth/login?next=%2Fklubhuset')
    for (const url of ['/api/archive', '/uploads/posters/x.jpg', '/tex/x.png', '/admin']) {
      expect((await app.inject({ url })).statusCode, url).toBe(401)
    }
    expect((await app.inject({ method: 'POST', url: '/admin/login', payload: {} })).statusCode).toBe(401)
    expect((await app.inject({ url: '/healthz' })).body).toBe('ok')
  })

  it('sends the person to Theta with PKCE, the groups scope and our callback', async () => {
    const { app } = setup()
    const res = await app.inject({ url: '/auth/login?next=/klubhuset' })
    const url = new URL(res.headers.location as string)
    expect(url.origin + url.pathname).toBe(`${ISSUER}/auth`)
    expect(url.searchParams.get('client_id')).toBe('albumklubben')
    expect(url.searchParams.get('redirect_uri')).toBe('https://ak.test/auth/callback')
    expect(url.searchParams.get('scope')).toBe('openid profile groups')
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

  it('logs out', async () => {
    const { app } = setup()
    const { cb } = await signIn(app)
    const out = await app.inject({ url: '/auth/logout', headers: { cookie: cookieHeader(cb, 'ak_member') } })
    expect(out.body).toContain('logget ud')
    expect(out.cookies.find(c => c.name === 'ak_member')?.value).toBe('')
  })

  it('only follows a next that stays on this site', () => {
    expect(safeNext('/klubhuset?x=1')).toBe('/klubhuset?x=1')
    for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test', undefined, 42]) expect(safeNext(bad)).toBe('/')
  })
})
