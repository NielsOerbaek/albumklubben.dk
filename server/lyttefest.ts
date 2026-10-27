import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Database } from './db.ts'
import { ThetaError, type Card, type ThetaApi } from './theta-api.ts'
import {
  addComment, albumTracklist, cancelFest, createFest, deleteComment, festAlbum, festsFrom, getFest,
  isComing, listComments, listFestsForAlbum, listRsvps, markOnce, moveFest, setFestPost, setRsvp,
  type FestRow,
} from './lyttefest-repo.ts'
import {
  festTracks, formatLength, positionAt, totalSeconds, trackIndexAt,
  type FestPerson, type FestView,
} from '../shared/lyttefest.ts'
import { firstName } from '../shared/board.ts'

/**
 * Lyttefesten: a member picks an album and a time; at that time everyone presses play on their
 * own speakers, and the site keeps them in step by counting through the frozen tracklist. It is
 * announced in the club's group with a card, and the live comments stay here until it is over,
 * when the bot puts them in the group as one comment — one post per lyttefest, no more.
 */
const MIN_AHEAD_MS = 10 * 60 * 1000
const MAX_AHEAD_MS = 60 * 24 * 60 * 60 * 1000
const MAX_NOTE = 280
const MAX_COMMENT = 500
/** How often the server looks for a reminder to send or a summary to post. */
export const TICK_MS = 10_000
const SUMMARY_LIMIT = 3500 // Theta takes more, but a wall of text helps nobody

declare module 'fastify' {
  interface FastifyInstance {
    /** Runs the reminder-and-summary pass now, rather than on the next tick. */
    lyttefestTick(): Promise<void>
  }
}

export interface LyttefestOptions {
  db: Database
  api: ThetaApi
  publicUrl: string
  /** The clock, so a test can decide what time it is. */
  now?: () => number
}

type Listener = (event: string, data: unknown) => void

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 || t.length > max ? null : t
}

/** "tirsdag 3. november kl. 11.30", in Copenhagen time, which is the time the club lives in. */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')}. ${get('month')} kl. ${get('hour')}.${get('minute')}`
}

export function registerLyttefest(app: FastifyInstance, opts: LyttefestOptions) {
  const { db, api } = opts
  const now = opts.now ?? (() => Date.now())
  const url = (id: number) => `${opts.publicUrl}/lyttefest/${id}`

  // Everyone watching a lyttefest live, in this one process. One server, so this is enough.
  const listeners = new Map<number, Set<Listener>>()
  const push = (id: number, event: string, data: unknown) => {
    for (const send of listeners.get(id) ?? []) {
      try { send(event, data) } catch { /* a listener that has gone away is dropped by its own route */ }
    }
  }

  const state = (f: FestRow) => positionAt(f.tracks, Date.parse(f.startsAt), now(), f.cancelledAt !== null)

  function view(f: FestRow, who: FestPerson): FestView | null {
    const album = festAlbum(db, f.albumId)
    if (!album) return null
    return {
      id: f.id,
      album,
      host: f.host,
      startsAt: f.startsAt,
      note: f.note,
      tracks: f.tracks,
      cancelled: f.cancelledAt !== null,
      thetaUrl: f.thetaPostUrl,
      coming: listRsvps(db, f.id),
      comments: listComments(db, f.id),
      you: { coming: isComing(db, f.id, who.sub), host: who.sub === f.host.sub },
      now: new Date(now()).toISOString(),
    }
  }

  // --- The card in the group --------------------------------------------------------------------

  const BADGE = {
    kommende: { text: 'Kommende', tone: 'info' as const },
    nu: { text: 'Nu', tone: 'success' as const },
    slut: { text: 'Slut', tone: 'neutral' as const },
    aflyst: { text: 'Aflyst', tone: 'danger' as const },
  }

  function cardFor(f: FestRow): Card {
    const album = festAlbum(db, f.albumId)
    const coming = listRsvps(db, f.id)
    const where = state(f)
    const over = where.state === 'slut' || where.state === 'aflyst'
    return {
      version: 'theta.card/v1',
      externalId: f.cardExternalId ?? `lyttefest-${f.id}`,
      title: 'Lyttefest',
      subtitle: album ? `${album.artist} – ${album.title}${album.year ? ` (${album.year})` : ''}` : 'Lyttefest',
      ...(f.note ? { body: f.note } : {}),
      badge: BADGE[where.state],
      fields: [
        { label: 'Tidspunkt', value: formatWhen(f.startsAt) },
        { label: 'Vært', value: f.host.name },
        { label: 'Spilletid', value: formatLength(totalSeconds(f.tracks)) },
        { label: 'Kommer', value: String(coming.length) },
      ],
      // A card's audience can only narrow who sees a button, so "Jeg kommer" shows for everyone
      // and pressing it twice is a no-op. Once it is over there is nothing to answer.
      actions: over ? [] : [
        { id: 'kommer', label: 'Jeg kommer', style: 'primary' as const },
        ...(coming.length > 0 ? [{
          id: 'kommer-ikke', label: 'Jeg kommer ikke alligevel', style: 'secondary' as const,
          audience: coming.map(c => c.sub),
        }] : []),
      ],
      link: { label: 'Åbn lyttefesten', url: url(f.id) },
    }
  }

  async function refreshCard(f: FestRow) {
    if (!f.cardExternalId) return
    try { await api.updateCard(cardFor(f)) } catch (err) { app.log.warn({ err, fest: f.id }, 'lyttefest card not updated') }
  }

  /** A note from the bot under the announcement. Never retried: see docs/theta-app-api.md. */
  async function botComment(f: FestRow, body: string, externalId: string) {
    if (!f.thetaPostId) return
    try {
      await api.createComment(f.thetaPostId, { author: { type: 'app' }, body, externalId })
    } catch (err) {
      app.log.warn({ err, fest: f.id }, 'lyttefest bot comment not posted')
    }
  }

  // --- Making one ---------------------------------------------------------------------------------

  app.post<{ Body: { albumId?: number; startsAt?: string; note?: string } }>('/api/lyttefest', async (req, reply) => {
    const who = req.member!
    const albumId = Number(req.body?.albumId)
    const album = Number.isFinite(albumId) ? festAlbum(db, albumId) : null
    if (!album) return reply.code(404).send({ error: 'Albummet findes ikke' })
    const tracks = festTracks(albumTracklist(db, albumId))
    if (!tracks) return reply.code(400).send({ error: 'Kræver en tracklist med spilletider' })

    const startsAt = Date.parse(String(req.body?.startsAt))
    if (!Number.isFinite(startsAt)) return reply.code(400).send({ error: 'Vælg et tidspunkt' })
    if (startsAt < now() + MIN_AHEAD_MS) return reply.code(400).send({ error: 'Vælg et tidspunkt mindst 10 minutter ude i fremtiden' })
    if (startsAt > now() + MAX_AHEAD_MS) return reply.code(400).send({ error: 'Vælg et tidspunkt inden for de næste 60 dage' })
    const note = req.body?.note ? text(req.body.note, MAX_NOTE) : null
    if (req.body?.note && note === null) return reply.code(400).send({ error: 'Beskeden er for lang' })

    const startsIso = new Date(startsAt).toISOString()
    const id = createFest(db, { albumId, host: who, startsAt: startsIso, note, tracks }, new Date(now()).toISOString())
    const fest = getFest(db, id)!
    const externalId = `lyttefest-${id}`

    // Announced as the host. If Theta will not take it from them, nothing is made: posting it as
    // the bot instead would walk a suspended member straight past the group's moderation.
    try {
      const post = await api.createPost({
        author: { type: 'user', sub: who.sub },
        body: [`Lyttefest: ${album.artist} – ${album.title}, ${formatWhen(startsIso)}`, note, url(id)]
          .filter(Boolean).join('\n\n'),
        externalId,
        card: { ...cardFor(fest), externalId },
      })
      setFestPost(db, id, { thetaPostId: post.id, thetaPostUrl: post.url, cardExternalId: externalId, postedAs: 'user' })
    } catch (err) {
      db.prepare('DELETE FROM lyttefester WHERE id = ?').run(id)
      if (err instanceof ThetaError && err.notEligible) {
        return reply.code(403).send({ error: 'Du kan ikke skrive i gruppen lige nu' })
      }
      app.log.warn({ err }, 'lyttefest not announced')
      return reply.code(502).send({ error: 'Theta tog ikke imod opslaget' })
    }
    // The host is coming, obviously.
    setRsvp(db, id, who, true, new Date(now()).toISOString())
    return view(getFest(db, id)!, who)
  })

  // --- Reading one --------------------------------------------------------------------------------

  const load = (reply: FastifyReply, id: string): FestRow | null => {
    const fest = Number.isFinite(Number(id)) ? getFest(db, Number(id)) : null
    if (!fest) { reply.code(404).send({ error: 'Lyttefesten findes ikke' }); return null }
    return fest
  }

  app.get<{ Params: { id: string } }>('/api/lyttefest/:id', async (req, reply) => {
    const fest = load(reply, req.params.id)
    if (!fest) return reply
    reply.header('Cache-Control', 'no-store')
    return view(fest, req.member!) ?? reply.code(404).send({ error: 'Lyttefesten findes ikke' })
  })

  app.get<{ Params: { id: string } }>('/api/albums/:id/lyttefester', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return listFestsForAlbum(db, Number(req.params.id))
  })

  // --- Coming, or not -----------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: { coming?: boolean } }>('/api/lyttefest/:id/rsvp', async (req, reply) => {
    const fest = load(reply, req.params.id)
    if (!fest) return reply
    if (fest.cancelledAt) return reply.code(409).send({ error: 'Lyttefesten er aflyst' })
    const coming = req.body?.coming !== false
    setRsvp(db, fest.id, req.member!, coming, new Date(now()).toISOString())
    const people = listRsvps(db, fest.id)
    push(fest.id, 'coming', people)
    void refreshCard(getFest(db, fest.id)!)
    return { coming: people }
  })

  // --- What is said while it plays -----------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: { text?: string } }>('/api/lyttefest/:id/comments', async (req, reply) => {
    const fest = load(reply, req.params.id)
    if (!fest) return reply
    const body = text(req.body?.text, MAX_COMMENT)
    if (!body) return reply.code(400).send({ error: 'Skriv noget først' })
    const at = now()
    const comment = addComment(db, fest.id, req.member!, body,
      trackIndexAt(fest.tracks, Date.parse(fest.startsAt), at), new Date(at).toISOString())
    push(fest.id, 'comment', comment)
    return comment
  })

  app.delete<{ Params: { id: string; commentId: string } }>('/api/lyttefest/:id/comments/:commentId', async (req, reply) => {
    const fest = load(reply, req.params.id)
    if (!fest) return reply
    const gone = deleteComment(db, fest.id, Number(req.params.commentId), req.member!.sub, fest.host.sub,
      new Date(now()).toISOString())
    if (!gone) return reply.code(403).send({ error: 'Den kan kun fjernes af den, der skrev den, eller af værten' })
    push(fest.id, 'deleted', { id: Number(req.params.commentId) })
    return { ok: true }
  })

  // --- The host's two levers -----------------------------------------------------------------------

  const hostOnly = (reply: FastifyReply, fest: FestRow, sub: string): boolean => {
    if (fest.host.sub === sub) return true
    reply.code(403).send({ error: 'Kun værten kan ændre lyttefesten' })
    return false
  }

  app.post<{ Params: { id: string }; Body: { startsAt?: string } }>('/api/lyttefest/:id/udskyd', async (req, reply) => {
    const fest = load(reply, req.params.id)
    if (!fest) return reply
    if (!hostOnly(reply, fest, req.member!.sub)) return reply
    if (fest.cancelledAt) return reply.code(409).send({ error: 'Lyttefesten er aflyst' })
    if (state(fest).state !== 'kommende') return reply.code(409).send({ error: 'Lyttefesten er allerede i gang' })
    const startsAt = Date.parse(String(req.body?.startsAt))
    if (!Number.isFinite(startsAt) || startsAt < now() + MIN_AHEAD_MS || startsAt > now() + MAX_AHEAD_MS) {
      return reply.code(400).send({ error: 'Vælg et tidspunkt mindst 10 minutter ude i fremtiden' })
    }
    const iso = new Date(startsAt).toISOString()
    moveFest(db, fest.id, iso)
    const moved = getFest(db, fest.id)!
    push(fest.id, 'moved', { startsAt: iso })
    await refreshCard(moved)
    await botComment(moved, `Flyttet til ${formatWhen(iso)}.`, `lyttefest-${fest.id}-flyttet-${startsAt}`)
    return view(moved, req.member!)
  })

  app.post<{ Params: { id: string } }>('/api/lyttefest/:id/aflys', async (req, reply) => {
    const fest = load(reply, req.params.id)
    if (!fest) return reply
    if (!hostOnly(reply, fest, req.member!.sub)) return reply
    cancelFest(db, fest.id, new Date(now()).toISOString())
    const off = getFest(db, fest.id)!
    push(fest.id, 'cancelled', {})
    await refreshCard(off)
    await botComment(off, 'Aflyst.', `lyttefest-${fest.id}-aflyst`)
    return view(off, req.member!)
  })

  // --- Live ------------------------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/api/lyttefest/:id/events', (req, reply) => {
    const fest = load(reply, req.params.id)
    if (!fest) return reply
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      // The room and the page are on the same origin; no proxy should buffer this.
      'x-accel-buffering': 'no',
    })
    const send: Listener = (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const set = listeners.get(fest.id) ?? new Set()
    set.add(send)
    listeners.set(fest.id, set)
    send('hello', { now: new Date(now()).toISOString() })
    // A comment line every half minute, so nothing in between closes a quiet stream.
    const beat = setInterval(() => reply.raw.write(': ❤\n\n'), 30_000)
    const stop = () => {
      clearInterval(beat)
      set.delete(send)
      if (set.size === 0) listeners.delete(fest.id)
    }
    req.raw.on('close', stop)
    req.raw.on('error', stop)
    return reply
  })

  // --- The clock: one reminder, and one summary ----------------------------------------------------

  /** The comments gathered under their tracks, as one comment for the group. */
  function summaryText(f: FestRow): string {
    const album = festAlbum(db, f.albumId)
    const comments = listComments(db, f.id)
    const head = `Lyttefesten for ${album?.artist} – ${album?.title} er slut.`
    if (comments.length === 0) return `${head}\n\n${url(f.id)}`
    const byTrack = new Map<number | null, typeof comments>()
    for (const c of comments) byTrack.set(c.trackIndex, [...(byTrack.get(c.trackIndex) ?? []), c])
    const parts: string[] = [head, '']
    for (const track of f.tracks) {
      const said = byTrack.get(track.number - 1)
      if (!said?.length) continue
      parts.push(`${track.number}. ${track.title}`)
      for (const c of said) parts.push(`${firstName(c.name)}: ${c.text}`)
      parts.push('')
    }
    let body = parts.join('\n').trimEnd()
    if (body.length > SUMMARY_LIMIT) body = `${body.slice(0, SUMMARY_LIMIT).trimEnd()} …`
    return `${body}\n\n${url(f.id)}`
  }

  /**
   * Called on a timer, and once at start-up, so a restart does not lose a reminder or a summary.
   * Each job is claimed in the database before it is done, so it happens once.
   */
  async function tick() {
    const at = now()
    for (const f of festsFrom(db, new Date(at - MAX_AHEAD_MS).toISOString())) {
      if (f.cancelledAt) continue
      const where = positionAt(f.tracks, Date.parse(f.startsAt), at)
      if (where.state === 'nu' && !f.remindedAt && markOnce(db, f.id, 'reminded_at', new Date(at).toISOString())) {
        const album = festAlbum(db, f.albumId)
        const coming = listRsvps(db, f.id).map(c => c.sub)
        push(f.id, 'started', {})
        try {
          await api.notify(coming, `Lyttefesten for ${album?.artist} – ${album?.title} starter nu`, url(f.id))
        } catch (err) { app.log.warn({ err, fest: f.id }, 'lyttefest reminder not sent') }
        await refreshCard(getFest(db, f.id)!)
      }
      if (where.state === 'slut' && !f.summaryPostedAt && markOnce(db, f.id, 'summary_posted_at', new Date(at).toISOString())) {
        push(f.id, 'ended', {})
        await botComment(f, summaryText(f), `lyttefest-${f.id}-summary`)
        await refreshCard(getFest(db, f.id)!)
      }
    }
  }

  // Named on the app as well, so a test can move the clock and tick it by hand.
  app.decorate('lyttefestTick', tick)
  const timer = setInterval(() => { void tick() }, TICK_MS)
  timer.unref?.()
  app.addHook('onClose', async () => clearInterval(timer))

  // --- A button on the card in Theta -------------------------------------------------------------

  /**
   * What a `dk.theta.card.action` carries. The names are the interop README's, which was not at
   * hand: every spelling the rest of the API would suggest is accepted, and this is the one place
   * to correct. See "Mangler stadig" in docs/theta-app-api.md.
   */
  function readAction(data: Record<string, any>) {
    return {
      externalId: String(data.externalId ?? data.card?.externalId ?? data.card ?? ''),
      action: String(data.action?.id ?? data.actionId ?? data.action ?? ''),
      sub: String(data.user?.sub ?? data.actor?.sub ?? data.sub ?? ''),
      name: String(data.user?.name ?? data.actor?.name ?? data.name ?? ''),
    }
  }

  /** Answered with the card as it now looks, which is what Theta puts back in the post. */
  async function onCardAction(data: Record<string, any>): Promise<Card | null> {
    const { externalId, action, sub, name } = readAction(data)
    const id = Number(/^lyttefest-(\d+)$/.exec(externalId)?.[1])
    const fest = Number.isFinite(id) ? getFest(db, id) : null
    if (!fest || !sub) return null
    if (action === 'kommer' || action === 'kommer-ikke') {
      if (fest.cancelledAt) return cardFor(fest)
      setRsvp(db, fest.id, { sub, name: name || 'Et medlem' }, action === 'kommer', new Date(now()).toISOString())
      push(fest.id, 'coming', listRsvps(db, fest.id))
    }
    return cardFor(getFest(db, fest.id)!)
  }

  return { tick, onCardAction }
}
