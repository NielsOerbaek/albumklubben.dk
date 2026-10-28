import {existsSync, readdirSync} from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { saveImage } from '../../server/files.ts'
import { openDb } from '../../server/db.ts'
import type { findTracklist } from '../../server/musicbrainz.ts'
import { getMeeting, listMeetings } from '../../server/repo.ts'
import type { Archive } from '../../shared/types.ts'
import { tmp } from '../tmp.ts'

const setup = (musicbrainz?: typeof findTracklist) => {
  const uploadDir = tmp('admin-')
  const db = openDb(':memory:')
  const app = buildApp({ db, uploadDir, adminPassword: 'hemmelig', sessionSecret: 'secret', musicbrainz })
  return { app, db, uploadDir }
}
type Ctx = ReturnType<typeof setup>

const form = (o: Record<string, string>) => new URLSearchParams(o).toString()
const URLENC = { 'content-type': 'application/x-www-form-urlencoded' }

async function login(app: Ctx['app']) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', headers: URLENC, payload: form({ password: 'hemmelig' }) })
  const c = res.cookies.find(x => x.name === 'ak_admin')!
  return { cookie: `ak_admin=${c.value}` }
}

interface Part { name: string; value?: string; filename?: string; type?: string; data?: Buffer }
function multipart(parts: Part[]) {
  const b = '----testboundary'
  const chunks: Buffer[] = []
  for (const p of parts) {
    const disp = `Content-Disposition: form-data; name="${p.name}"${p.filename !== undefined ? `; filename="${p.filename}"` : ''}`
    const type = p.filename !== undefined ? `\r\nContent-Type: ${p.type ?? 'application/octet-stream'}` : ''
    chunks.push(Buffer.from(`--${b}\r\n${disp}${type}\r\n\r\n`), p.data ?? Buffer.from(p.value ?? ''), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${b}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${b}` } }
}

const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer()
const albumFields = (extra: Record<string, string> = {}): Part[] =>
  Object.entries({ artist: 'Lily Allen', title: 'West End Girl', year: '2025', card_color: '#302c21', ...extra })
    .map(([name, value]) => ({ name, value }))
const files = (uploadDir: string, dir: string) => (existsSync(join(uploadDir, dir)) ? readdirSync(join(uploadDir, dir)) : [])

async function newMeeting(c: Ctx, cookie: string, number = '23') {
  await c.app.inject({ method: 'POST', url: '/admin/meetings/new', headers: { ...URLENC, cookie }, payload: form({ number, theme: 'Fest' }) })
  return listMeetings(c.db).find(m => m.number === Number(number))!
}

describe('admin cross-origin writes', () => {
  const attempt = async (extra: Record<string, string>) => {
    const c = setup()
    const { cookie } = await login(c.app)
    const res = await c.app.inject({ method: 'POST', url: '/admin/meetings/new', headers: { ...URLENC, cookie, ...extra }, payload: form({ number: '7' }) })
    return { res, count: listMeetings(c.db).length }
  }

  it('rejects a sibling-subdomain Origin and changes nothing', async () => {
    const { res, count } = await attempt({ origin: 'https://evil.osogdata.dk', host: 'albumklubben.dk' })
    expect(res.statusCode).toBe(403)
    expect(count).toBe(0)
  })

  it('rejects Sec-Fetch-Site: same-site', async () => {
    const { res, count } = await attempt({ 'sec-fetch-site': 'same-site' })
    expect(res.statusCode).toBe(403)
    expect(count).toBe(0)
  })

  it('accepts a matching Origin', async () => {
    const { res, count } = await attempt({ origin: 'https://albumklubben.dk', host: 'albumklubben.dk' })
    expect(res.statusCode).toBe(302)
    expect(count).toBe(1)
  })

  it('rejects a cross-origin login', async () => {
    const res = await setup().app.inject({ method: 'POST', url: '/admin/login', headers: { ...URLENC, origin: 'https://evil.osogdata.dk', host: 'a.osogdata.dk' }, payload: form({ password: 'hemmelig' }) })
    expect(res.statusCode).toBe(403)
    expect(res.cookies).toHaveLength(0)
  })
})

describe('admin auth', () => {
  it('redirects to login without a session', async () => {
    const res = await setup().app.inject('/admin')
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
  })

  it('POST without a session is 401', async () => {
    const res = await setup().app.inject({ method: 'POST', url: '/admin/meetings/new', headers: URLENC, payload: form({ number: '1' }) })
    expect(res.statusCode).toBe(401)
  })

  it('wrong password shows "Forkert adgangskode"', async () => {
    const res = await setup().app.inject({ method: 'POST', url: '/admin/login', headers: URLENC, payload: form({ password: 'nej' }) })
    expect(res.body).toContain('Forkert adgangskode')
    expect(res.cookies).toHaveLength(0)
  })

  it('percent-encoded paths do not bypass the session check', async () => {
    const c = setup()
    const get = await c.app.inject('/%61dmin')
    expect(get.statusCode).toBe(302)
    expect(get.headers.location).toBe('/admin/login')
    const post = await c.app.inject({ method: 'POST', url: '/%61dmin/meetings/new', headers: URLENC, payload: form({ number: '7' }) })
    expect(post.statusCode).toBe(401)
    expect(listMeetings(c.db)).toHaveLength(0)
  })

  it('a forged cookie is not a session', async () => {
    const res = await setup().app.inject({ url: '/admin', headers: { cookie: 'ak_admin=ok' } })
    expect(res.statusCode).toBe(302)
  })

  it('the right password sets a signed, HttpOnly, Secure cookie', async () => {
    const { app } = setup()
    const res = await app.inject({ method: 'POST', url: '/admin/login', headers: URLENC, payload: form({ password: 'hemmelig' }) })
    expect(res.statusCode).toBe(302)
    const c = res.cookies.find(x => x.name === 'ak_admin')!
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' })
    expect((await app.inject({ url: '/admin', headers: { cookie: `ak_admin=${c.value}` } })).statusCode).toBe(200)
  })
})

describe('admin CMS', () => {
  it('creates a meeting, adds an album with a cover upload, and the album appears in /api/archive', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart([...albumFields(), { name: 'cover', filename: 'c.png', type: 'image/png', data: await png() }])
    const res = await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    expect(res.statusCode).toBe(302)
    const archive = (await c.app.inject('/api/archive')).json() as Archive
    const album = archive.meetings[0].albums[0]
    expect(album).toMatchObject({ artist: 'Lily Allen', year: 2025, cardColor: '#302c21' })
    expect(album.coverUrl).toMatch(/^\/uploads\/covers\//)
    expect((await c.app.inject(album.coverUrl!)).statusCode).toBe(200)
  })

  it('takes the band\'s lineup as four counts, and shows them again in the form', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart(albumFields({
      lineup_men: '5', lineup_women: '1', lineup_nonbinary: '', lineup_other: 'ikke et tal',
    }))
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })

    const album = listMeetings(c.db)[0].albums[0]
    // Blank and nonsense are nobody, not a crash and not a NaN in the database.
    expect(album.lineup).toEqual({ men: 5, women: 1, nonbinary: 0, other: 0 })

    const form = await c.app.inject({ url: `/admin/albums/${album.id}`, headers: { cookie } })
    expect(form.body).toContain('name="lineup_men" value="5"')
    expect(form.body).toContain('name="lineup_women" value="1"')
    expect(form.body).toContain('name="lineup_nonbinary" value="0"')
  })

  it('rejects a text file as cover: no album row, no new file in uploads/covers', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart([...albumFields(), { name: 'cover', filename: 'c.jpg', type: 'image/jpeg', data: Buffer.from('hej') }])
    const res = await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Filen er ikke et billede')
    expect(res.body).toContain('Lily Allen')
    expect(getMeeting(c.db, m.id)!.albums).toHaveLength(0)
    expect(files(c.uploadDir, 'covers')).toEqual([])
  })

  it('rejects a .mov video: no poster row, no file in uploads/videos or posters', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart([
      { name: 'caption', value: 'Plakat' },
      { name: 'image', filename: 'p.png', type: 'image/png', data: await png() },
      { name: 'video', filename: 'v.mov', type: 'video/quicktime', data: Buffer.from('x') },
    ])
    const res = await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/posters/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('mp4 eller webm')
    expect(getMeeting(c.db, m.id)!.posters).toHaveLength(0)
    expect(files(c.uploadDir, 'videos')).toEqual([])
    expect(files(c.uploadDir, 'posters')).toEqual([])
  })

  it('a poster with an mp4 is saved with image and video', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart([
      { name: 'image', filename: 'p.png', type: 'image/png', data: await png() },
      { name: 'video', filename: 'v.mp4', type: 'video/mp4', data: Buffer.from('x') },
    ])
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/posters/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    const [p] = getMeeting(c.db, m.id)!.posters
    expect(p.videoUrl).toMatch(/^\/uploads\/videos\/.*\.mp4$/)
    const edit = multipart([{ name: 'remove_video', value: 'ja' }])
    await c.app.inject({ method: 'POST', url: `/admin/posters/${p.id}`, headers: { ...edit.headers, cookie }, payload: edit.payload })
    expect(getMeeting(c.db, m.id)!.posters[0].videoUrl).toBeNull()
    expect(files(c.uploadDir, 'videos')).toEqual([])
    expect(files(c.uploadDir, 'posters')).toHaveLength(1)
  })

  it('escapes a story containing <script> on the album edit page', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const story = '<script>alert("æøå 🎵")</script>'
    const body = multipart(albumFields({ story }))
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    const album = getMeeting(c.db, m.id)!.albums[0]
    expect(album.story).toBe(story)
    const page = await c.app.inject({ url: `/admin/albums/${album.id}`, headers: { cookie } })
    expect(page.body).toContain('&lt;script&gt;')
    expect(page.body).not.toContain('<script>')
    expect(page.body).toContain('æøå 🎵')
  })

  it('deleting a meeting without confirm=ja does nothing; with it, removes rows and files', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart([...albumFields(), { name: 'cover', filename: 'c.png', data: await png() }])
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/delete`, headers: { ...URLENC, cookie }, payload: form({}) })
    expect(getMeeting(c.db, m.id)).toBeDefined()
    expect(files(c.uploadDir, 'covers')).toHaveLength(1)
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/delete`, headers: { ...URLENC, cookie }, payload: form({ confirm: 'ja' }) })
    expect(getMeeting(c.db, m.id)).toBeUndefined()
    expect(files(c.uploadDir, 'covers')).toEqual([])
  })

  it('deleting an album removes its cached derivatives, and .cache is not served', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart([...albumFields(), { name: 'cover', filename: 'c.png', data: await png() }])
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    const cover = getMeeting(c.db, m.id)!.albums[0].coverUrl!
    expect((await c.app.inject(cover.replace('/uploads/', '/tex/128/'))).statusCode).toBe(200)
    expect((await c.app.inject(cover.replace('/uploads/', '/thumb/512/'))).statusCode).toBe(200)
    const name = `${cover.replace('/uploads/', '').replaceAll('/', '_')}.png`
    const cached = `.cache/128/${name}`, thumb = `.cache/thumb-512/${name}`
    expect(existsSync(join(c.uploadDir, cached))).toBe(true)
    expect(existsSync(join(c.uploadDir, thumb))).toBe(true)
    expect((await c.app.inject(`/uploads/${cached}`)).statusCode).toBe(404)
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/delete`, headers: { ...URLENC, cookie }, payload: form({ confirm: 'ja' }) })
    expect(existsSync(join(c.uploadDir, cached))).toBe(false)
    expect(existsSync(join(c.uploadDir, thumb))).toBe(false)
  })

  it('stores a rotated phone photo upright', async () => {
    const { uploadDir } = setup()
    const jpg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#f00' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const rel = await saveImage(uploadDir, jpg, 'covers')
    const meta = await sharp(join(uploadDir, rel)).metadata()
    expect([meta.width, meta.height]).toEqual([100, 200])
  })

  it('move reorders albums', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    for (const artist of ['A', 'B']) {
      const body = multipart(albumFields({ artist }))
      await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    }
    const [, b] = getMeeting(c.db, m.id)!.albums
    await c.app.inject({ method: 'POST', url: `/admin/albums/${b.id}/move`, headers: { ...URLENC, cookie }, payload: form({ dir: 'up' }) })
    expect(getMeeting(c.db, m.id)!.albums.map(a => a.artist)).toEqual(['B', 'A'])
  })

  it('validates forms and returns 404 for unknown ids', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const dup = await c.app.inject({ method: 'POST', url: '/admin/meetings/new', headers: { ...URLENC, cookie }, payload: form({ number: '23' }) })
    expect(dup.statusCode).toBe(400)
    const bad = multipart(albumFields({ card_color: 'red', year: '99', lat: '10' }))
    const res = await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...bad.headers, cookie }, payload: bad.payload })
    expect(res.statusCode).toBe(400)
    expect(getMeeting(c.db, m.id)!.albums).toHaveLength(0)
    const upd = multipart(albumFields())
    expect((await c.app.inject({ method: 'POST', url: '/admin/albums/999', headers: { ...upd.headers, cookie }, payload: upd.payload })).statusCode).toBe(404)
    expect((await c.app.inject({ url: '/admin/meetings/999', headers: { cookie } })).statusCode).toBe(404)
  })

  it('replacing a cover removes the old file', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const mk = async () => multipart([...albumFields(), { name: 'cover', filename: 'c.png', data: await png() }])
    const first = await mk()
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...first.headers, cookie }, payload: first.payload })
    const a = getMeeting(c.db, m.id)!.albums[0]
    const second = await mk()
    await c.app.inject({ method: 'POST', url: `/admin/albums/${a.id}`, headers: { ...second.headers, cookie }, payload: second.payload })
    expect(files(c.uploadDir, 'covers')).toHaveLength(1)
    expect(getMeeting(c.db, m.id)!.albums[0].coverUrl).not.toBe(a.coverUrl)
  })
})

describe('admin tracklist and about', () => {
  it('saves an album tracklist and a poster about text', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart(albumFields({ tracklist: 'Intro 1:02\r\nOutro' }))
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    expect(getMeeting(c.db, m.id)!.albums[0].tracklist).toBe('Intro 1:02\nOutro')
    const pb = multipart([{ name: 'about', value: 'Om plakaten' }, { name: 'image', filename: 'p.png', type: 'image/png', data: await png() }])
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/posters/new`, headers: { ...pb.headers, cookie }, payload: pb.payload })
    expect(getMeeting(c.db, m.id)!.posters[0].about).toBe('Om plakaten')
  })

  it('keeps the tracklist and about text when an album or poster is edited through the form', async () => {
    const c = setup()
    const { cookie } = await login(c.app)
    const m = await newMeeting(c, cookie)
    const body = multipart(albumFields({ tracklist: 'Intro 1:02\nOutro' }))
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/albums/new`, headers: { ...body.headers, cookie }, payload: body.payload })
    const a = getMeeting(c.db, m.id)!.albums[0]
    const page = (await c.app.inject({ url: `/admin/albums/${a.id}`, headers: { cookie } })).body
    expect(page).toContain('name="tracklist"')
    expect(page).toContain('Intro 1:02\nOutro</textarea>')
    expect(page).toContain('data-musicbrainz')
    const fields = [...page.matchAll(/<textarea name="(\w+)"[^>]*>([^<]*)<\/textarea>/g)].map(x => ({ name: x[1], value: x[2] }))
    const edit = multipart([...albumFields({ title: 'Nyt navn' }).filter(p => p.name !== 'tracklist'), ...fields.filter(f => f.name === 'tracklist')])
    await c.app.inject({ method: 'POST', url: `/admin/albums/${a.id}`, headers: { ...edit.headers, cookie }, payload: edit.payload })
    expect(getMeeting(c.db, m.id)!.albums[0]).toMatchObject({ title: 'Nyt navn', tracklist: 'Intro 1:02\nOutro' })

    const pb = multipart([{ name: 'about', value: 'Om plakaten' }, { name: 'image', filename: 'p.png', type: 'image/png', data: await png() }])
    await c.app.inject({ method: 'POST', url: `/admin/meetings/${m.id}/posters/new`, headers: { ...pb.headers, cookie }, payload: pb.payload })
    const p = getMeeting(c.db, m.id)!.posters[0]
    const ppage = (await c.app.inject({ url: `/admin/posters/${p.id}`, headers: { cookie } })).body
    expect(ppage).toContain('name="about"')
    expect(ppage).toContain('Om plakaten</textarea>')
    const pe = multipart([{ name: 'caption', value: 'Ny tekst' }, { name: 'about', value: 'Om plakaten' }])
    await c.app.inject({ method: 'POST', url: `/admin/posters/${p.id}`, headers: { ...pe.headers, cookie }, payload: pe.payload })
    expect(getMeeting(c.db, m.id)!.posters[0]).toMatchObject({ caption: 'Ny tekst', about: 'Om plakaten' })
  })
})

describe('admin MusicBrainz route', () => {
  const q = '/admin/musicbrainz?artist=Aphex%20Twin&title=Windowlicker'

  it('needs a session', async () => {
    const lookup = vi.fn()
    const res = await setup(lookup).app.inject(q)
    expect(res.statusCode).toBe(302)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('relays the lookup', async () => {
    const lookup = vi.fn(async () => ({ tracklist: 'A 1:00', release: 'X (2000, GB), 1 spor' }))
    const c = setup(lookup)
    const { cookie } = await login(c.app)
    const res = await c.app.inject({ url: q, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ tracklist: 'A 1:00', release: 'X (2000, GB), 1 spor' })
    expect(lookup).toHaveBeenCalledWith('Aphex Twin', 'Windowlicker')
  })

  it('answers 404 when MusicBrainz does not know the album, 502 when it fails', async () => {
    const c = setup(async () => null)
    const r404 = await c.app.inject({ url: q, headers: { cookie: (await login(c.app)).cookie } })
    expect(r404.statusCode).toBe(404)
    expect(r404.json()).toEqual({ error: 'MusicBrainz kender ikke albummet' })
    const bad = setup(async () => { throw new Error('503') })
    const r502 = await bad.app.inject({ url: q, headers: { cookie: (await login(bad.app)).cookie } })
    expect(r502.statusCode).toBe(502)
    expect(r502.json()).toEqual({ error: 'MusicBrainz svarer ikke lige nu. Prøv igen om lidt.' })
  })

  it('serves admin.js', async () => {
    const res = await setup().app.inject('/admin/admin.js')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect((await setup().app.inject('/admin/meetings/new')).statusCode).toBe(302)
  })
})
