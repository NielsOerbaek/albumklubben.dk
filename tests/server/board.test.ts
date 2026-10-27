import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { openDb } from '../../server/db.ts'
import { ThetaError, type BoardComment, type BoardPost, type Page, type ThetaApi } from '../../server/theta-api.ts'

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
  createdAt: '2026-10-27T09:00:00.000Z', commentCount: 0, attachmentCount: 0, pinned: false, url: null,
})

/** Counts what actually reached Theta, so the cache can be seen working. */
function fakeApi(overrides: Partial<ThetaApi> = {}) {
  const reads: string[] = []
  const writes: any[] = []
  const api = {
    posts: async (viewer: string): Promise<Page<BoardPost>> => {
      reads.push(`posts|${viewer}`)
      return { items: [post('1', `til ${viewer}`)], nextCursor: null }
    },
    comments: async (viewer: string, postId: string): Promise<Page<BoardComment>> => {
      reads.push(`comments|${viewer}|${postId}`)
      return { items: [], nextCursor: null }
    },
    createPost: async (input: any) => { writes.push(input); return post('9', input.body) },
    createComment: async (postId: string, input: any) => {
      writes.push({ postId, ...input })
      return { id: '5', author: { sub: input.author.sub, name: 'Medlem 1' }, body: input.body, createdAt: '', depth: 0 }
    },
    updateCard: async () => {},
    notify: async () => {},
    ...overrides,
  } as ThetaApi
  return { api, reads, writes }
}

function setup(overrides: Partial<ThetaApi> = {}, sub = 'sub-1') {
  const theta = fakeApi(overrides)
  const app = buildApp({
    db: openDb(':memory:'),
    uploadDir: mkdtempSync(join(tmpdir(), 'board-')),
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
    for (const url of ['/api/board', '/api/board/posts/1/comments']) {
      expect((await app.inject({ url })).statusCode, url).toBe(401)
    }
    expect((await app.inject({ method: 'POST', url: '/api/board/posts', payload: { body: 'Hej' } })).statusCode).toBe(401)
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

  it('goes back to Theta after the member has written something', async () => {
    const { app, reads, writes } = setup()
    const cookie = await signIn(app)
    await app.inject({ url: '/api/board', headers: { cookie } })
    const res = await app.inject({
      method: 'POST', url: '/api/board/posts', headers: { cookie },
      payload: { body: 'Et nyt opslag', title: 'Hej', externalId: 'e-1' },
    })
    expect(res.statusCode).toBe(200)
    // Written as the person, with the id that keeps a retry from posting twice.
    expect(writes[0]).toEqual({ author: { type: 'user', sub: 'sub-1' }, body: 'Et nyt opslag', title: 'Hej', externalId: 'e-1' })
    await app.inject({ url: '/api/board', headers: { cookie } })
    expect(reads).toEqual(['posts|sub-1', 'posts|sub-1'])
  })

  it('makes an externalId when the page did not send one', async () => {
    const { app, writes } = setup()
    const cookie = await signIn(app)
    await app.inject({ method: 'POST', url: '/api/board/posts/7/comments', headers: { cookie }, payload: { body: 'Enig' } })
    expect(writes[0].postId).toBe('7')
    expect(writes[0].externalId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('says no to an empty or endless post', async () => {
    const { app, writes } = setup()
    const cookie = await signIn(app)
    for (const payload of [{ body: '   ' }, {}, { body: 'x'.repeat(5001) }]) {
      const res = await app.inject({ method: 'POST', url: '/api/board/posts', headers: { cookie }, payload })
      expect(res.statusCode, JSON.stringify(payload).slice(0, 30)).toBe(400)
    }
    expect(writes).toEqual([])
  })

  it('turns a refused read into "log ind igen", because the consent or the membership is gone', async () => {
    const { app } = setup({ posts: async () => { throw new ThetaError(404, 'notFound', 'Blev ikke fundet.') } })
    const cookie = await signIn(app)
    const res = await app.inject({ url: '/api/board', headers: { cookie } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Log ind igen')
  })

  it('says plainly when Theta will not take a post from this member', async () => {
    const { app } = setup({ createPost: async () => { throw new ThetaError(403, 'userNotEligible', 'Nej.') } })
    const cookie = await signIn(app)
    const res = await app.inject({ method: 'POST', url: '/api/board/posts', headers: { cookie }, payload: { body: 'Hej' } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('Du kan ikke skrive i gruppen lige nu')
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
