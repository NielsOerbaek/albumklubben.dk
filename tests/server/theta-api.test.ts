import { describe, expect, it } from 'vitest'
import { ThetaError, createThetaApi } from '../../server/theta-api.ts'

const ISSUER = 'https://theta.test/oidc'
const GROUP = '122304557724776'

/**
 * A fake App API. What it takes and answers is the contract written down in
 * `docs/theta-app-api.md`, which was read off the real stage server.
 */
function fakeTheta(handler?: (url: string, init: RequestInit) => Response | undefined) {
  const calls: { method: string; url: string; body: any }[] = []
  let tokens = 0
  const fetch: typeof globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body
    calls.push({ method, url, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    if (url.endsWith('/.well-known/openid-configuration')) return json({ token_endpoint: `${ISSUER}/token` })
    if (url === `${ISSUER}/token`) return json({ access_token: `app-token-${++tokens}`, expires_in: 300, token_type: 'Bearer' })
    const mine = handler?.(url, init)
    if (mine) return mine
    return json({ error: { code: 'notFound', message: 'Blev ikke fundet.', fields: null, retryAfter: null } }, 404)
  }) as typeof globalThis.fetch
  return { fetch, calls, get tokens() { return tokens } }
}

const api = (theta: ReturnType<typeof fakeTheta>) =>
  createThetaApi({ issuer: ISSUER, clientId: 'albumklubben', clientSecret: 's3cret', groupId: GROUP, fetch: theta.fetch })

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('Theta App API', () => {
  it('gets one app token with client_credentials and keeps using it', async () => {
    const theta = fakeTheta((url) => url.includes('/posts') ? ok({ posts: [], nextCursor: null }) : undefined)
    const a = api(theta)
    await a.posts('sub-1')
    await a.posts('sub-2')
    expect(theta.tokens).toBe(1)
    const token = theta.calls.find(c => c.url === `${ISSUER}/token`)!
    expect(String(token.body)).toBe('grant_type=client_credentials&scope=app')
    expect(theta.calls.filter(c => c.url.includes('/api/v1/app/')).every(c => c.url.startsWith('https://theta.test/'))).toBe(true)
  })

  it('reads the group as the person, and pages with a cursor', async () => {
    const theta = fakeTheta((url) => url.includes('/posts') ? ok({
      posts: [{
        id: 7, author: { sub: 'sub-9', name: 'Medlem 1' }, title: 'Hej', body: 'Et opslag',
        createdAt: '2026-10-27T09:00:00.000Z', commentCount: 2, attachments: [{}, {}, {}], pinned: true,
        url: 'https://theta.test/p/7',
      }],
      nextCursor: 'c2',
    }) : undefined)
    const first = await api(theta).posts('sub-1')
    const url = new URL(theta.calls.at(-1)!.url)
    expect(url.pathname).toBe(`/api/v1/app/groups/${GROUP}/posts`)
    expect(url.searchParams.get('viewer')).toBe('sub-1')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('cursor')).toBeNull()
    expect(first.nextCursor).toBe('c2')
    expect(first.items[0]).toEqual({
      id: '7', author: { sub: 'sub-9', name: 'Medlem 1' }, title: 'Hej', body: 'Et opslag',
      createdAt: '2026-10-27T09:00:00.000Z', commentCount: 2, attachmentCount: 3, pinned: true,
      url: 'https://theta.test/p/7',
    })
    await api(theta).posts('sub-1', 'c2')
    expect(new URL(theta.calls.at(-1)!.url).searchParams.get('cursor')).toBe('c2')
  })

  it('writes a post as the person, with the group and an externalId', async () => {
    const theta = fakeTheta((url, init) =>
      url.endsWith('/api/v1/app/posts') && init.method === 'POST'
        ? ok({ id: 11, author: { sub: 'sub-1', name: 'Medlem 1' }, body: 'Hej', createdAt: '2026-10-27T10:00:00.000Z' })
        : undefined)
    const post = await api(theta).createPost({ author: { type: 'user', sub: 'sub-1' }, body: 'Hej', externalId: 'e-1' })
    const call = theta.calls.at(-1)!
    // The text field is `body`, not `text`: an unknown field would be dropped in silence.
    expect(call.body).toEqual({ group: GROUP, author: { type: 'user', sub: 'sub-1' }, body: 'Hej', externalId: 'e-1' })
    expect(post.id).toBe('11')
  })

  it('writes a comment on a post', async () => {
    const theta = fakeTheta((url, init) => url.includes('/comments') && init.method === 'POST'
      ? ok({ id: 3, author: { sub: 'sub-1', name: 'Medlem 1' }, body: 'Enig', createdAt: '2026-10-27T10:05:00.000Z', depth: 0 })
      : undefined)
    await api(theta).createComment('11', { author: { type: 'app' }, body: 'Enig', externalId: 'e-2' })
    const call = theta.calls.at(-1)!
    expect(call.url).toContain('/api/v1/app/posts/11/comments')
    expect(call.body).toEqual({ author: { type: 'app' }, body: 'Enig', externalId: 'e-2' })
  })

  it('updates a card by its externalId, and sends a bell notification to the people named', async () => {
    const theta = fakeTheta((url, init) =>
      (init.method === 'PUT' && url.includes('/cards/')) || url.endsWith('/notifications') ? ok({}) : undefined)
    const a = api(theta)
    const card = { version: 'theta.card/v1' as const, externalId: 'lyttefest-1', title: 'Lyttefest' }
    await a.updateCard(card)
    expect(theta.calls.at(-1)!.url).toContain('/api/v1/app/cards/lyttefest-1')
    expect(theta.calls.at(-1)!.body).toEqual({ card })
    await a.notify(['sub-1', 'sub-2'], 'Lyttefesten starter nu', 'https://ak.test/lyttefest/1')
    expect(theta.calls.at(-1)!.body).toEqual({
      recipients: ['sub-1', 'sub-2'], text: 'Lyttefesten starter nu', href: 'https://ak.test/lyttefest/1',
    })
    const before = theta.calls.length
    await a.notify([], 'ingen', 'https://ak.test/')
    expect(theta.calls.length).toBe(before)
  })

  it('turns Theta\'s error envelope into an error that says which kind it was', async () => {
    const theta = fakeTheta((url, init) => init.method === 'POST' && url.endsWith('/api/v1/app/posts')
      ? new Response(JSON.stringify({ error: { code: 'userNotEligible', message: 'Nej.', fields: null, retryAfter: null } }), { status: 403 })
      : undefined)
    const a = api(theta)
    await expect(a.createPost({ author: { type: 'user', sub: 'x' }, body: 'Hej' })).rejects.toSatisfy(
      (e: ThetaError) => e instanceof ThetaError && e.notEligible && !e.refused)
    // Every refusal of a read is a 404, whatever the reason.
    await expect(a.posts('ukendt')).rejects.toSatisfy((e: ThetaError) => e.refused && e.code === 'notFound')
  })
})
