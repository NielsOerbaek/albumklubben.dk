import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { openDb, type Database } from '../../server/db.ts'
import { ThetaError, type Card, type ThetaApi } from '../../server/theta-api.ts'
import { formatWhen } from '../../server/lyttefest.ts'

const ISSUER = 'https://theta.test/oidc'
const GROUP = '122304557724776'
const SECRET = 'webhook-hemmelighed'
const LIST = 'En 3:00\nTo 4:30\nTre 2:30' // ti minutter i alt
const START = Date.UTC(2026, 10, 3, 10, 30)

const oidc = (sub: string) => (async (input: string | URL) => {
  const url = String(input)
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
  if (url.endsWith('/.well-known/openid-configuration')) {
    return json({ authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/me` })
  }
  if (url === `${ISSUER}/token`) return json({ access_token: 'at', id_token: 'idt' })
  return json({ sub, name: sub === 'sub-1' ? 'Medlem Een' : 'Medlem To', groups: [{ id: GROUP }] })
}) as typeof globalThis.fetch

/** Theta, recording what the site asked it to post, update and notify. */
function fakeApi(over: Partial<ThetaApi> = {}) {
  const posts: any[] = []
  const comments: any[] = []
  const cards: Card[] = []
  const notes: { recipients: string[]; text: string; href: string }[] = []
  const api = {
    posts: async () => ({ items: [], nextCursor: null }),
    comments: async () => ({ items: [], nextCursor: null }),
    createPost: async (input: any) => {
      posts.push(input)
      return { id: `p${posts.length}`, url: `https://theta.test/p/${posts.length}`, author: { sub: '', name: '' },
        title: null, body: input.body, createdAt: '', commentCount: 0, attachmentCount: 0, pinned: false }
    },
    createComment: async (postId: string, input: any) => {
      comments.push({ postId, ...input })
      return { id: `c${comments.length}`, author: { sub: '', name: '' }, body: input.body, createdAt: '', depth: 0 }
    },
    updateCard: async (card: Card) => { cards.push(card) },
    notify: async (recipients: string[], text: string, href: string) => { notes.push({ recipients, text, href }) },
    ...over,
  } as unknown as ThetaApi
  return { api, posts, comments, cards, notes }
}

let clock = START - 60 * 60 * 1000 // an hour before the lyttefest

function setup(over: Partial<ThetaApi> = {}, sub = 'sub-1') {
  const theta = fakeApi(over)
  const db = openDb(':memory:')
  const app = buildApp({
    db,
    uploadDir: mkdtempSync(join(tmpdir(), 'fest-')),
    adminPassword: 'hemmelig',
    sessionSecret: 'secret',
    theta: { issuer: ISSUER, clientId: 'albumklubben', clientSecret: 's3cret', groupId: GROUP, publicUrl: 'https://ak.test', fetch: oidc(sub) },
    thetaApi: theta.api,
    thetaWebhookSecret: SECRET,
    now: () => clock,
  })
  const albumId = seedAlbum(db, LIST)
  return { app, db, albumId, ...theta }
}

/** A meeting with one album, so a lyttefest has something to play. */
let meetingNumber = 0
function seedAlbum(db: Database, tracklist: string | null): number {
  const meeting = db.prepare('INSERT INTO meetings (number, date) VALUES (?, ?)')
    .run(++meetingNumber, '2026-04-21')
  return Number(db.prepare(`INSERT INTO albums (meeting_id, position, artist, title, year, card_color, tracklist)
    VALUES (?, 1, 'Kate Bush', 'The Kick Inside', 1978, '#fe3ebe', ?)`)
    .run(meeting.lastInsertRowid, tracklist).lastInsertRowid)
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

const make = (app: any, cookie: string, body: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/lyttefest', headers: { cookie }, payload: { startsAt: new Date(START).toISOString(), ...body } })

beforeEach(() => { clock = START - 60 * 60 * 1000 })

describe('at lave en lyttefest', () => {
  it('stores it, announces it in the group as the host, and puts the host on the list', async () => {
    const { app, albumId, posts } = setup()
    const cookie = await signIn(app)
    const res = await make(app, cookie, { albumId, note: 'Tag en kop kaffe med' })
    expect(res.statusCode).toBe(200)
    const fest = res.json()
    expect(fest.album.title).toBe('The Kick Inside')
    expect(fest.tracks).toHaveLength(3)
    expect(fest.you).toEqual({ coming: true, host: true })
    expect(fest.coming.map((c: any) => c.sub)).toEqual(['sub-1'])

    expect(posts).toHaveLength(1)
    expect(posts[0].author).toEqual({ type: 'user', sub: 'sub-1' })
    expect(posts[0].body).toContain('Lyttefest: Kate Bush – The Kick Inside')
    expect(posts[0].body).toContain('Tag en kop kaffe med')
    expect(posts[0].body).toContain('https://ak.test/lyttefest/1')
    expect(posts[0].externalId).toBe('lyttefest-1')
  })

  it('sends a card Theta can show, with the two buttons and the state', async () => {
    const { app, albumId, posts } = setup()
    const card = (await make(app, await signIn(app), { albumId })).json() && posts[0].card
    expect(card.version).toBe('theta.card/v1')
    expect(card.title).toBe('Lyttefest')
    expect(card.subtitle).toBe('Kate Bush – The Kick Inside (1978)')
    expect(card.badge).toEqual({ text: 'Kommende', tone: 'info' })
    expect(card.fields.map((f: any) => f.label)).toEqual(['Tidspunkt', 'Vært', 'Spilletid', 'Kommer'])
    expect(card.fields.find((f: any) => f.label === 'Spilletid').value).toBe('10 min.')
    expect(card.actions.map((a: any) => a.id)).toEqual(['kommer'])
    expect(card.link).toEqual({ label: 'Åbn lyttefesten', url: 'https://ak.test/lyttefest/1' })
  })

  it('refuses an album whose tracklist has no times', async () => {
    const { app, db, posts } = setup()
    const bare = seedAlbum(db, 'En\nTo')
    const res = await make(app, await signIn(app), { albumId: bare })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Kræver en tracklist med spilletider')
    expect(posts).toHaveLength(0)
  })

  it('refuses a time that is too close, too far out, or not a time at all', async () => {
    const { app, albumId } = setup()
    const cookie = await signIn(app)
    for (const startsAt of [
      new Date(clock + 5 * 60_000).toISOString(),
      new Date(clock + 61 * 24 * 3600_000).toISOString(),
      'på tirsdag', undefined,
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/lyttefest', headers: { cookie }, payload: { albumId, startsAt } })
      expect(res.statusCode, String(startsAt)).toBe(400)
    }
  })

  it('makes nothing at all when Theta will not take the announcement from this member', async () => {
    const { app, db, albumId } = setup({ createPost: async () => { throw new ThetaError(403, 'userNotEligible', 'Nej.') } })
    const res = await make(app, await signIn(app), { albumId })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('Du kan ikke skrive i gruppen lige nu')
    // Nothing is left behind, and it is never posted as the bot instead.
    expect(db.prepare('SELECT COUNT(*) AS n FROM lyttefester').get()).toEqual({ n: 0 })
  })
})

describe('mens den kører', () => {
  it('counts through the tracklist, the same sum the page makes', async () => {
    const { app, albumId } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const read = async () => (await app.inject({ url: '/api/lyttefest/1', headers: { cookie } })).json()
    const before = await read()
    expect(before.cancelled).toBe(false)
    expect(Date.parse(before.now)).toBe(clock)
    clock = START + 185_000 // five seconds into the second track
    const during = await read()
    expect(during.tracks[1].title).toBe('To')
    expect(Date.parse(during.now)).toBe(clock)
  })

  it('tags a comment with the track it was written during', async () => {
    const { app, albumId } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const write = (text: string) =>
      app.inject({ method: 'POST', url: '/api/lyttefest/1/comments', headers: { cookie }, payload: { text } })
    await write('Før vi går i gang')
    clock = START + 10_000
    await write('Den her er god')
    clock = START + 185_000
    await write('Nummer to!')
    clock = START + 10 * 60_000
    await write('Det var det')
    const fest = (await app.inject({ url: '/api/lyttefest/1', headers: { cookie } })).json()
    expect(fest.comments.map((c: any) => [c.trackIndex, c.text])).toEqual([
      [null, 'Før vi går i gang'], [0, 'Den her er god'], [1, 'Nummer to!'], [null, 'Det var det'],
    ])
  })

  it('says no to an empty or endless comment', async () => {
    const { app, albumId } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    for (const text of ['  ', undefined, 'x'.repeat(501)]) {
      const res = await app.inject({ method: 'POST', url: '/api/lyttefest/1/comments', headers: { cookie }, payload: { text } })
      expect(res.statusCode).toBe(400)
    }
  })

  it('lets the one who wrote a comment take it down, and nobody else', async () => {
    const { app, db, albumId } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const made = (await app.inject({ method: 'POST', url: '/api/lyttefest/1/comments', headers: { cookie }, payload: { text: 'Hov' } })).json()
    // The same lyttefest, read by somebody else's session.
    const guest = buildApp({
      db, uploadDir: mkdtempSync(join(tmpdir(), 'fest3-')), adminPassword: 'x', sessionSecret: 'secret',
      theta: { issuer: ISSUER, clientId: 'albumklubben', clientSecret: 's', groupId: GROUP, publicUrl: 'https://ak.test', fetch: oidc('sub-2') },
      thetaApi: fakeApi().api, now: () => clock,
    })
    const otherCookie = await signIn(guest)
    const refused = await guest.inject({ method: 'DELETE', url: `/api/lyttefest/1/comments/${made.id}`, headers: { cookie: otherCookie } })
    expect(refused.statusCode).toBe(403)
    const gone = await app.inject({ method: 'DELETE', url: `/api/lyttefest/1/comments/${made.id}`, headers: { cookie } })
    expect(gone.statusCode).toBe(200)
    const fest = (await app.inject({ url: '/api/lyttefest/1', headers: { cookie } })).json()
    expect(fest.comments).toHaveLength(0)
  })
})

describe('hvem der kommer', () => {
  it('takes a yes and a no, and keeps the count on the card right', async () => {
    const { app, albumId, cards } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const off = await app.inject({ method: 'POST', url: '/api/lyttefest/1/rsvp', headers: { cookie }, payload: { coming: false } })
    expect(off.json().coming).toEqual([])
    const on = await app.inject({ method: 'POST', url: '/api/lyttefest/1/rsvp', headers: { cookie }, payload: { coming: true } })
    expect(on.json().coming.map((c: any) => c.sub)).toEqual(['sub-1'])
    expect(cards.at(-1)!.fields!.find(f => f.label === 'Kommer')!.value).toBe('1')
    // Only those who are coming are offered the way out of it.
    expect(cards.at(-1)!.actions!.map(a => a.id)).toEqual(['kommer', 'kommer-ikke'])
    expect(cards.at(-1)!.actions!.find(a => a.id === 'kommer-ikke')!.audience).toEqual(['sub-1'])
  })

  it('takes "Jeg kommer" pressed on the card in Theta, and answers with the new card', async () => {
    const { app, albumId } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const event = {
      specversion: '1.0', type: 'dk.theta.card.action', id: 'ev-1',
      data: { externalId: 'lyttefest-1', action: { id: 'kommer' }, user: { sub: 'sub-9', name: 'Medlem Ni' } },
    }
    const raw = JSON.stringify(event)
    const t = Math.floor(Date.now() / 1000)
    const res = await app.inject({
      method: 'POST', url: '/theta/webhook', payload: raw,
      headers: {
        'content-type': 'application/json',
        'theta-signature': `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.`).update(raw).digest('hex')}`,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().card.fields.find((f: any) => f.label === 'Kommer').value).toBe('2')
    const fest = (await app.inject({ url: '/api/lyttefest/1', headers: { cookie } })).json()
    expect(fest.coming.map((c: any) => c.name)).toEqual(['Medlem Een', 'Medlem Ni'])
  })

  it('takes the same press twice without putting anyone on twice', async () => {
    const { app, albumId } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const twice = await app.inject({ method: 'POST', url: '/api/lyttefest/1/rsvp', headers: { cookie }, payload: { coming: true } })
    expect(twice.json().coming).toHaveLength(1)
  })
})

describe('værtens to håndtag', () => {
  it('moves it, tells the group, and asks for the reminder again', async () => {
    const { app, albumId, comments, cards } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const later = new Date(START + 2 * 3600_000).toISOString()
    const res = await app.inject({ method: 'POST', url: '/api/lyttefest/1/udskyd', headers: { cookie }, payload: { startsAt: later } })
    expect(res.statusCode).toBe(200)
    expect(res.json().startsAt).toBe(later)
    expect(comments.at(-1)!.body).toContain('Flyttet til')
    expect(comments.at(-1)!.author).toEqual({ type: 'app' })
    expect(cards.at(-1)!.fields!.find(f => f.label === 'Tidspunkt')!.value).toBe(formatWhen(later))
  })

  it('cancels it, and says so on the card and in the group', async () => {
    const { app, albumId, comments, cards } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    const res = await app.inject({ method: 'POST', url: '/api/lyttefest/1/aflys', headers: { cookie } })
    expect(res.json().cancelled).toBe(true)
    expect(cards.at(-1)!.badge).toEqual({ text: 'Aflyst', tone: 'danger' })
    expect(cards.at(-1)!.actions).toEqual([])
    expect(comments.at(-1)!.body).toBe('Aflyst.')
  })

  it('lets nobody but the host move or cancel it', async () => {
    const { app, db, albumId } = setup()
    await make(app, await signIn(app), { albumId })
    // The same database, read by someone else's session.
    const guest = buildApp({
      db, uploadDir: mkdtempSync(join(tmpdir(), 'fest2-')), adminPassword: 'x', sessionSecret: 'secret',
      theta: { issuer: ISSUER, clientId: 'albumklubben', clientSecret: 's', groupId: GROUP, publicUrl: 'https://ak.test', fetch: oidc('sub-2') },
      thetaApi: fakeApi().api, now: () => clock,
    })
    const cookie = await signIn(guest)
    for (const url of ['/api/lyttefest/1/aflys', '/api/lyttefest/1/udskyd']) {
      const res = await guest.inject({ method: 'POST', url, headers: { cookie }, payload: { startsAt: new Date(START + 7200_000).toISOString() } })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error).toBe('Kun værten kan ændre lyttefesten')
    }
  })

  it('will not move one that has already started', async () => {
    const { app, albumId } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    clock = START + 60_000
    const res = await app.inject({ method: 'POST', url: '/api/lyttefest/1/udskyd', headers: { cookie },
      payload: { startsAt: new Date(clock + 3600_000).toISOString() } })
    expect(res.statusCode).toBe(409)
  })
})

describe('uret: én påmindelse og ét referat', () => {
  it('rings the bell once for those who are coming, when it starts', async () => {
    const { app, albumId, notes } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    clock = START - 1000
    await app.lyttefestTick()
    expect(notes).toHaveLength(0)
    clock = START + 1000
    await app.lyttefestTick()
    await app.lyttefestTick() // a second pass must not ring twice
    expect(notes).toHaveLength(1)
    expect(notes[0].recipients).toEqual(['sub-1'])
    expect(notes[0].text).toContain('starter nu')
    expect(notes[0].href).toBe('https://ak.test/lyttefest/1')
  })

  it('puts the comments in the group as one comment when it is over, and only once', async () => {
    const { app, albumId, comments } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    clock = START + 10_000
    await app.inject({ method: 'POST', url: '/api/lyttefest/1/comments', headers: { cookie }, payload: { text: 'God start' } })
    clock = START + 185_000
    await app.inject({ method: 'POST', url: '/api/lyttefest/1/comments', headers: { cookie }, payload: { text: 'Og nu den her' } })

    clock = START + 9 * 60_000
    await app.lyttefestTick()
    expect(comments.filter(c => c.externalId.endsWith('-summary'))).toHaveLength(0)
    clock = START + 11 * 60_000
    await app.lyttefestTick()
    await app.lyttefestTick() // a second pass must not post it twice
    const summaries = comments.filter(c => c.externalId === 'lyttefest-1-summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].author).toEqual({ type: 'app' })
    expect(summaries[0].body).toContain('1. En')
    expect(summaries[0].body).toContain('Medlem: God start')
    expect(summaries[0].body).toContain('2. To')
    expect(summaries[0].body).toContain('Medlem: Og nu den her')
    expect(summaries[0].body).toContain('https://ak.test/lyttefest/1')
  })

  it('leaves a cancelled lyttefest alone', async () => {
    const { app, albumId, notes, comments } = setup()
    const cookie = await signIn(app)
    await make(app, cookie, { albumId })
    await app.inject({ method: 'POST', url: '/api/lyttefest/1/aflys', headers: { cookie } })
    clock = START + 11 * 60_000
    await app.lyttefestTick()
    expect(notes).toHaveLength(0)
    expect(comments.filter(c => c.externalId?.endsWith('-summary'))).toHaveLength(0)
  })
})
