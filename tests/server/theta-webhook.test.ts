import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { openDb } from '../../server/db.ts'
import { verify } from '../../server/theta-webhook.ts'
import type { BoardPost, Page, ThetaApi } from '../../server/theta-api.ts'

const ISSUER = 'https://theta.test/oidc'
const GROUP = '122304557724776'
const SECRET = 'webhook-hemmelighed'

const fakeOidc = (async (input: string | URL) => {
  const url = String(input)
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
  if (url.endsWith('/.well-known/openid-configuration')) {
    return json({ authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/me` })
  }
  if (url === `${ISSUER}/token`) return json({ access_token: 'at', id_token: 'idt' })
  return json({ sub: 'sub-1', name: 'Medlem 1', groups: [{ id: GROUP }] })
}) as typeof globalThis.fetch

function setup() {
  const reads: string[] = []
  const api = {
    posts: async (viewer: string): Promise<Page<BoardPost>> => {
      reads.push(viewer)
      return { items: [], nextCursor: null }
    },
    comments: async () => ({ items: [], nextCursor: null }),
    createPost: async () => ({}) as BoardPost,
    createComment: async () => ({}) as any,
    updateCard: async () => {},
    notify: async () => {},
  } as unknown as ThetaApi
  const app = buildApp({
    db: openDb(':memory:'),
    uploadDir: mkdtempSync(join(tmpdir(), 'hook-')),
    adminPassword: 'hemmelig',
    sessionSecret: 'secret',
    theta: { issuer: ISSUER, clientId: 'albumklubben', clientSecret: 's3cret', groupId: GROUP, publicUrl: 'https://ak.test', fetch: fakeOidc },
    thetaApi: api,
    thetaWebhookSecret: SECRET,
  })
  return { app, reads }
}

const sign = (raw: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex')}`

const send = (app: ReturnType<typeof setup>['app'], event: unknown, signature?: (raw: string) => string) => {
  const raw = JSON.stringify(event)
  return app.inject({
    method: 'POST', url: '/theta/webhook', payload: raw,
    headers: { 'content-type': 'application/json', 'theta-signature': (signature ?? sign)(raw) },
  })
}

async function signIn(app: ReturnType<typeof setup>['app']) {
  const start = await app.inject({ url: '/auth/login' })
  const state = new URL(start.headers.location as string).searchParams.get('state')!
  const cb = await app.inject({
    url: `/auth/callback?code=c1&state=${state}`,
    headers: { cookie: `ak_oidc=${start.cookies.find(c => c.name === 'ak_oidc')!.value}` },
  })
  return `ak_member=${cb.cookies.find(c => c.name === 'ak_member')!.value}`
}

const posted = { specversion: '1.0', type: 'dk.theta.group.posted', id: 'ev-1', data: { group: GROUP, post: '12' } }

describe('Thetas webhook', () => {
  it('takes a signed event without a login', async () => {
    const { app } = setup()
    const res = await send(app, posted)
    expect(res.statusCode).toBe(200)
  })

  it('refuses one that is not signed, signed with the wrong secret, or tampered with', async () => {
    const { app } = setup()
    const raw = JSON.stringify(posted)
    const unsigned = await app.inject({ method: 'POST', url: '/theta/webhook', payload: raw, headers: { 'content-type': 'application/json' } })
    expect(unsigned.statusCode).toBe(401)
    expect((await send(app, posted, r => sign(r, 'en anden hemmelighed'))).statusCode).toBe(401)
    // A signature made for one body does not carry to another.
    const stolen = sign(raw)
    const tampered = await app.inject({
      method: 'POST', url: '/theta/webhook', payload: JSON.stringify({ ...posted, data: { group: 'en anden gruppe' } }),
      headers: { 'content-type': 'application/json', 'theta-signature': stolen },
    })
    expect(tampered.statusCode).toBe(401)
  })

  it('refuses an old signature, so one cannot be replayed later', async () => {
    const { app } = setup()
    const old = Math.floor(Date.now() / 1000) - 10 * 60
    expect((await send(app, posted, r => sign(r, SECRET, old))).statusCode).toBe(401)
  })

  it('makes the board go back to Theta for the next read', async () => {
    const { app, reads } = setup()
    const cookie = await signIn(app)
    await app.inject({ url: '/api/board', headers: { cookie } })
    await app.inject({ url: '/api/board', headers: { cookie } })
    expect(reads).toHaveLength(1) // the second one came from the cache
    expect((await send(app, posted)).statusCode).toBe(200)
    await app.inject({ url: '/api/board', headers: { cookie } })
    expect(reads).toHaveLength(2)
  })

  it('receives an event it does not act on without asking Theta to send it again', async () => {
    const { app } = setup()
    const res = await send(app, { ...posted, type: 'dk.theta.noget.andet' })
    expect(res.statusCode).toBe(200)
  })

  it('does not let a signed webhook body reach the rest of the site', async () => {
    const { app } = setup()
    // The raw-body parser lives in the webhook's own scope: ordinary JSON routes are unaffected.
    const res = await app.inject({ method: 'POST', url: '/api/board/posts', payload: { body: 'Hej' } })
    expect(res.statusCode).toBe(401)
  })

  it('checks the signature itself, and fails closed on anything odd', () => {
    const raw = Buffer.from('{"type":"dk.theta.group.posted"}')
    const t = Math.floor(Date.now() / 1000)
    const good = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.`).update(raw).digest('hex')}`
    expect(verify(SECRET, good, raw)).toBe(true)
    for (const header of [undefined, '', 'nonsense', `t=${t}`, `t=ikke-et-tal,v1=abc`, `t=${t},v1=`]) {
      expect(verify(SECRET, header, raw), String(header)).toBe(false)
    }
    expect(verify('', good, raw)).toBe(false)
  })
})
