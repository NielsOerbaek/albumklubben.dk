import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../db.ts'
import { removeFiles, saveImage, saveVideo } from '../files.ts'
import {
  createAlbum, createMeeting, createPoster, deleteAlbum, deleteMeeting, deletePoster, getMeeting,
  listMeetings, moveAlbum, movePoster, updateAlbum, updateMeeting, updatePoster,
} from '../repo.ts'
import type { Album, Poster } from '../../shared/types.ts'
import { registerAuth, requireAdmin } from './auth.ts'
import { parseAlbumForm, parseMeetingForm, parsePosterForm } from './forms.ts'
import {
  albumForm, meetingPage, meetingsPage, newMeetingPage, notFoundPage, posterForm,
} from './views.ts'

type Fields = Record<string, string>
type Kind = 'cover' | 'image' | 'video'
interface Upload { fields: Fields; saved: Partial<Record<Kind, string>>; error?: { field: Kind; message: string } }

const CSS = readFileSync(join(import.meta.dirname, 'admin.css'), 'utf8')

export interface AdminOptions { db: Database; uploadDir: string; adminPassword: string }

export function registerAdmin(app: FastifyInstance, { db, uploadDir, adminPassword }: AdminOptions) {
  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type('text/html').send(body)
  const notFound = (reply: FastifyReply) => html(reply, notFoundPage(), 404)
  const back = (reply: FastifyReply, meetingId: number, flash: string) =>
    reply.redirect(`/admin/meetings/${meetingId}?flash=${encodeURIComponent(flash)}`)
  const id = (req: FastifyRequest) => Number((req.params as { id: string }).id)
  const albumRow = (i: number): Album | undefined => listMeetings(db).flatMap(m => m.albums).find(a => a.id === i)
  const posterRow = (i: number): Poster | undefined => listMeetings(db).flatMap(m => m.posters).find(p => p.id === i)
  const relPath = (url: string | null) => url?.replace(/^\/uploads\//, '') ?? null

  /**
   * Reads a multipart form. Files are validated and stored as they arrive; the first failure
   * is kept and every later file is drained unsaved. The caller removes `saved` files if the
   * write does not go through, so a rejected form leaves nothing behind.
   */
  async function readUpload(req: FastifyRequest): Promise<Upload> {
    const up: Upload = { fields: {}, saved: {} }
    const cleanup = () => removeFiles(uploadDir, Object.values(up.saved))
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') { up.fields[part.fieldname] = String(part.value); continue }
        const kind = part.fieldname as Kind
        if (up.error || !part.filename || !['cover', 'image', 'video'].includes(kind)) { part.file.resume(); continue }
        try {
          if (kind === 'video') {
            const path = await saveVideo(uploadDir, part.file, part.filename)
            if (part.file.truncated) { removeFiles(uploadDir, [path]); throw new Error('Videoen er større end 500 MB') }
            up.saved.video = path
          } else {
            up.saved[kind] = await saveImage(uploadDir, await part.toBuffer(), kind === 'cover' ? 'covers' : 'posters')
          }
        } catch (err) {
          up.error = { field: kind, message: err instanceof Error ? err.message : 'Upload mislykkedes' }
          part.file.resume()
        }
      }
    } catch {
      cleanup()
      return { fields: up.fields, saved: {}, error: { field: 'image', message: 'Formularen kunne ikke læses' } }
    }
    if (up.error) { cleanup(); up.saved = {} }
    return up
  }
  const discard = (up: Upload) => removeFiles(uploadDir, Object.values(up.saved))

  app.get('/admin/admin.css', (_req, reply) => reply.type('text/css').send(CSS))
  registerAuth(app, adminPassword)
  // Everything registered below is encapsulated: the guard applies to the matched route,
  // not the raw URL, so percent-encoded paths cannot slip past it.
  app.register(async app => {
  app.addHook('preHandler', requireAdmin)

  const flashOf = (req: FastifyRequest) => (req.query as { flash?: string }).flash

  app.get('/admin', (req, reply) => html(reply, meetingsPage(listMeetings(db), flashOf(req))))

  // Meetings
  app.get('/admin/meetings/new', (_req, reply) => html(reply, newMeetingPage()))

  const numberTaken = (n: number, except?: number) => listMeetings(db).some(m => m.number === n && m.id !== except)
  const DUP = 'Der findes allerede et møde med det nummer'

  app.post<{ Body: Fields }>('/admin/meetings/new', (req, reply) => {
    const r = parseMeetingForm(req.body ?? {})
    if (r.ok && numberTaken(r.value.number)) return html(reply, newMeetingPage(req.body, { number: DUP }), 400)
    if (!r.ok) return html(reply, newMeetingPage(req.body, r.errors), 400)
    const mid = createMeeting(db, r.value)
    return back(reply, mid, 'Mødet er oprettet')
  })

  app.get('/admin/meetings/:id', (req, reply) => {
    const m = getMeeting(db, id(req))
    if (!m) return notFound(reply)
    const v: Fields = { number: String(m.number), date: m.date ?? '', time: m.time ?? '', theme: m.theme ?? '' }
    return html(reply, meetingPage(m, v, {}, flashOf(req)))
  })

  app.post<{ Body: Fields }>('/admin/meetings/:id', (req, reply) => {
    const m = getMeeting(db, id(req))
    if (!m) return notFound(reply)
    const r = parseMeetingForm(req.body ?? {})
    const errors = r.ok ? (numberTaken(r.value.number, m.id) ? { number: DUP } : null) : r.errors
    if (errors || !r.ok) return html(reply, meetingPage(m, req.body, errors ?? {}), 400)
    updateMeeting(db, m.id, r.value)
    return back(reply, m.id, 'Mødet er gemt')
  })

  app.post<{ Body: Fields }>('/admin/meetings/:id/delete', (req, reply) => {
    const m = getMeeting(db, id(req))
    if (!m) return notFound(reply)
    if (req.body?.confirm !== 'ja') return back(reply, m.id, 'Mødet blev ikke slettet: bekræftelse mangler')
    removeFiles(uploadDir, deleteMeeting(db, m.id))
    return reply.redirect(`/admin?flash=${encodeURIComponent('Mødet er slettet')}`)
  })

  // Albums
  const albumValues = (a: Album): Fields => ({
    artist: a.artist, title: a.title, year: a.year?.toString() ?? '', origin: a.origin, country: a.country,
    lat: a.lat?.toString() ?? '', lng: a.lng?.toString() ?? '', genre: a.genre, gender: a.gender,
    status: a.status, picked_by_name: a.pickedByName ?? '', picked_by_workplace: a.pickedByWorkplace ?? '',
    story: a.story ?? '', card_color: a.cardColor,
  })

  app.get('/admin/meetings/:id/albums/new', (req, reply) => {
    const m = getMeeting(db, id(req))
    if (!m) return notFound(reply)
    return html(reply, albumForm(m, `/admin/meetings/${m.id}/albums/new`, {}, {}, null, true))
  })

  app.post('/admin/meetings/:id/albums/new', async (req, reply) => {
    const m = getMeeting(db, id(req))
    if (!m) return notFound(reply)
    const up = await readUpload(req)
    const action = `/admin/meetings/${m.id}/albums/new`
    const r = parseAlbumForm(up.fields)
    const errors = up.error ? { [up.error.field === 'cover' ? 'cover' : 'form']: up.error.message } : r.ok ? null : r.errors
    if (errors || !r.ok) {
      discard(up)
      return html(reply, albumForm(m, action, up.fields, errors ?? {}, null, true), 400)
    }
    createAlbum(db, m.id, { ...r.value, coverPath: up.saved.cover ?? null })
    return back(reply, m.id, 'Albummet er oprettet')
  })

  app.get('/admin/albums/:id', (req, reply) => {
    const a = albumRow(id(req))
    if (!a) return notFound(reply)
    return html(reply, albumForm(getMeeting(db, a.meetingId)!, `/admin/albums/${a.id}`, albumValues(a), {}, a.coverUrl, false))
  })

  app.post('/admin/albums/:id', async (req, reply) => {
    const a = albumRow(id(req))
    if (!a) { await readUpload(req).then(discard); return notFound(reply) }
    const up = await readUpload(req)
    const r = parseAlbumForm(up.fields)
    const errors = up.error ? { [up.error.field === 'cover' ? 'cover' : 'form']: up.error.message } : r.ok ? null : r.errors
    if (errors || !r.ok) {
      discard(up)
      return html(reply, albumForm(getMeeting(db, a.meetingId)!, `/admin/albums/${a.id}`, up.fields, errors ?? {}, a.coverUrl, false), 400)
    }
    updateAlbum(db, a.id, { ...r.value, coverPath: up.saved.cover ?? relPath(a.coverUrl) })
    if (up.saved.cover) removeFiles(uploadDir, [relPath(a.coverUrl)].filter((p): p is string => !!p))
    return back(reply, a.meetingId, 'Albummet er gemt')
  })

  app.post('/admin/albums/:id/delete', (req, reply) => {
    const a = albumRow(id(req))
    if (!a) return notFound(reply)
    removeFiles(uploadDir, deleteAlbum(db, a.id))
    return back(reply, a.meetingId, 'Albummet er slettet')
  })

  app.post<{ Body: Fields }>('/admin/albums/:id/move', (req, reply) => {
    const a = albumRow(id(req))
    if (!a) return notFound(reply)
    moveAlbum(db, a.id, req.body?.dir === 'up' ? -1 : 1)
    return back(reply, a.meetingId, 'Rækkefølgen er ændret')
  })

  // Posters
  app.get('/admin/meetings/:id/posters/new', (req, reply) => {
    const m = getMeeting(db, id(req))
    if (!m) return notFound(reply)
    return html(reply, posterForm(m, `/admin/meetings/${m.id}/posters/new`, {}, {}, null))
  })

  app.post('/admin/meetings/:id/posters/new', async (req, reply) => {
    const m = getMeeting(db, id(req))
    if (!m) return notFound(reply)
    const up = await readUpload(req)
    const { caption } = parsePosterForm(up.fields).value
    const error = up.error ? { [up.error.field]: up.error.message } : !up.saved.image ? { image: 'Vælg et billede' } : null
    if (error) {
      discard(up)
      return html(reply, posterForm(m, `/admin/meetings/${m.id}/posters/new`, up.fields, error, null), 400)
    }
    createPoster(db, m.id, {
      imagePath: up.saved.image!, caption, videoPath: up.saved.video ?? null,
    })
    return back(reply, m.id, 'Plakaten er oprettet')
  })

  app.get('/admin/posters/:id', (req, reply) => {
    const p = posterRow(id(req))
    if (!p) return notFound(reply)
    return html(reply, posterForm(getMeeting(db, p.meetingId)!, `/admin/posters/${p.id}`, { caption: p.caption ?? '' }, {}, p))
  })

  app.post('/admin/posters/:id', async (req, reply) => {
    const p = posterRow(id(req))
    if (!p) { await readUpload(req).then(discard); return notFound(reply) }
    const up = await readUpload(req)
    if (up.error) {
      discard(up)
      return html(reply, posterForm(getMeeting(db, p.meetingId)!, `/admin/posters/${p.id}`, up.fields, { [up.error.field]: up.error.message }, p), 400)
    }
    const { caption } = parsePosterForm(up.fields).value
    const oldImage = relPath(p.imageUrl)!
    const oldVideo = relPath(p.videoUrl)
    const removeVideo = up.fields.remove_video === 'ja'
    const videoPath = up.saved.video ?? (removeVideo ? null : oldVideo)
    updatePoster(db, p.id, {
      imagePath: up.saved.image ?? oldImage, caption, videoPath,
    })
    removeFiles(uploadDir, [
      ...(up.saved.image ? [oldImage] : []),
      ...(oldVideo && videoPath !== oldVideo ? [oldVideo] : []),
    ])
    return back(reply, p.meetingId, 'Plakaten er gemt')
  })

  app.post('/admin/posters/:id/delete', (req, reply) => {
    const p = posterRow(id(req))
    if (!p) return notFound(reply)
    removeFiles(uploadDir, deletePoster(db, p.id))
    return back(reply, p.meetingId, 'Plakaten er slettet')
  })

  app.post<{ Body: Fields }>('/admin/posters/:id/move', (req, reply) => {
    const p = posterRow(id(req))
    if (!p) return notFound(reply)
    movePoster(db, p.id, req.body?.dir === 'up' ? -1 : 1)
    return back(reply, p.meetingId, 'Rækkefølgen er ændret')
  })
  })
}
