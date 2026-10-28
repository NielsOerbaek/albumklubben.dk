import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { openDb } from '../../server/db.ts'
import { ThetaError, type BoardPost, type Page, type ThetaApi } from '../../server/theta-api.ts'
import { tmp } from '../tmp.ts'

const ISSUER = 'https://theta.test/oidc'
const GROUP = '122304557724776'

/** Theta's sign-in, so a test can get a session cookie. */
function fakeOidc(sub: string) {
  return (async (input: string | URL) => {
    const url = String(input)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (url.endsWith('/.well-known/openid-configuration')) {
      return json({ authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/me` })
    }
    if (url === `${ISSUER}/token`) return json({ access_token: 'at', id_token: 'idt' })
    return json({ sub, name: 'Medlem 1', groups: [{ id: GROUP }] })
  }) as typeof globalThis.fetch
}

const post = (id: string, body: string): BoardPost => ({
  id, author: { sub: 'sub-9', name: 'Medlem 1' }, title: null, body,
  createdAt: '2026-10-27T09:00:00.000Z', commentCount: 0, attachmentCount: 0,
  url: `https://theta.test/grupper/${GROUP}/opslag/${id}`,
  lyttefest: null,
})

/** Counts what actually reached Theta, so the cache can be seen working. */
function fakeApi(overrides: Partial<ThetaApi> = {}) {
  const reads: string[] = []
  const api = {
    posts: async (viewer: string): Promise<Page<BoardPost>> => {
      reads.push(`posts|${viewer}`)
      return { items: [post('1', `til ${viewer}`)], nextCursor: null }
    },
    comments: async () => ({ items: [], nextCursor: null }),
    createPost: async () => post('9', ''),
    createComment: async () => ({ id: '5', author: { sub: '', name: '' }, body: '', createdAt: '', depth: 0 }),
    updateCard: async () => {},
    notify: async () => {},
    ...overrides,
  } as ThetaApi
  return { api, reads }
}

function setup(overrides: Partial<ThetaApi> = {}, sub = 'sub-1') {
  const theta = fakeApi(overrides)
  const app = buildApp({
    db: openDb(':memory:'),
    uploadDir: tmp('board-'),
    adminPassword: 'hemmelig',
    sessionSecret: 'secret',
    theta: { issuer: ISSUER, clientId: 'albumklubben', clientSecret: 's3cret', groupId: GROUP, publicUrl: 'https://ak.test', fetch: fakeOidc(sub) },
    thetaApi: theta.api,
  })
  return { app, ...theta }
}

/** Signs in and gives back the cookie header for the session. */
async function signIn(app: ReturnType<typeof setup>['app']) {
  const start = await app.inject({ url: '/auth/login' })
  const state = new URL(start.headers.location as string).searchParams.get('state')!
  const flow = start.cookies.find(c => c.name === 'ak_oidc')!
  const cb = await app.inject({ url: `/auth/callback?code=c1&state=${state}`, headers: { cookie: `ak_oidc=${flow.value}` } })
  const session = cb.cookies.find(c => c.name === 'ak_member')!
  return `ak_member=${session.value}`
}

describe('Opslagstavlen', () => {
  it('is behind the login, like everything else', async () => {
    const { app, reads } = setup()
    expect((await app.inject({ url: '/api/board' })).statusCode).toBe(401)
    expect(reads).toEqual([])
  })

  it('reads the group as the member who is logged in', async () => {
    const { app, reads } = setup()
    const cookie = await signIn(app)
    const res = await app.inject({ url: '/api/board', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().items[0].body).toBe('til sub-1')
    expect(reads).toEqual(['posts|sub-1'])
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('points at the group on Theta, which is where things are written', async () => {
    const { app } = setup()
    const res = await app.inject({ url: '/api/board', headers: { cookie: await signIn(app) } })
    expect(res.json().groupUrl).toBe(`https://theta.test/grupper/${GROUP}`)
    // And every post carries its own way in.
    expect(res.json().items[0].url).toBe(`https://theta.test/grupper/${GROUP}/opslag/1`)
  })

  it('writes nothing: the board is for reading, and Theta is for the rest', async () => {
    const { app } = setup()
    const cookie = await signIn(app)
    for (const [method, url] of [
      ['POST', '/api/board/posts'],
      ['POST', '/api/board/posts/1/comments'],
      ['GET', '/api/board/posts/1/comments'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { cookie }, payload: { body: 'Hej' } })
      expect(res.statusCode, `${method} ${url}`).toBe(404)
    }
  })

  it('never serves one member\'s read to another', async () => {
    const { app, reads } = setup()
    const one = await signIn(app)
    await app.inject({ url: '/api/board', headers: { cookie: one } })
    await app.inject({ url: '/api/board', headers: { cookie: one } })
    // The second read of the same page is the cache; a different person is not.
    expect(reads).toEqual(['posts|sub-1'])

    const other = setup({}, 'sub-2')
    const two = await signIn(other.app)
    const res = await other.app.inject({ url: '/api/board', headers: { cookie: two } })
    expect(res.json().items[0].body).toBe('til sub-2')
    expect(other.reads).toEqual(['posts|sub-2'])
  })

  it('turns a refused read into "log ind igen", because the consent or the membership is gone', async () => {
    const { app } = setup({ posts: async () => { throw new ThetaError(404, 'notFound', 'Blev ikke fundet.') } })
    const cookie = await signIn(app)
    const res = await app.inject({ url: '/api/board', headers: { cookie } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Log ind igen')
  })

  it('does not fall over when Theta is down', async () => {
    const { app } = setup({ posts: async () => { throw new Error('ECONNREFUSED') } })
    const cookie = await signIn(app)
    const res = await app.inject({ url: '/api/board', headers: { cookie } })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('Opslagstavlen kan ikke hentes lige nu')
    // The archive is untouched by Theta being away: the room must still load.
    expect((await app.inject({ url: '/api/archive', headers: { cookie } })).statusCode).toBe(200)
  })
})
