import type { FastifyInstance } from 'fastify'
import type { Database } from './db.ts'
import type { FestFace, FestPerson } from '../shared/lyttefest.ts'

/**
 * Who the club is, as Theta knows them: the name and the avatar, written down at each login.
 *
 * It is here because there is nowhere else to get a face from. Theta's App API can read a group
 * and write in it, but it has no "who is this sub", and the lyttefest tables keep the name a
 * member had when they wrote, not a link to them. So the one moment Theta tells us what someone
 * looks like is the `userinfo` call at login, and this is where that is kept.
 *
 * A member who has not logged in since this was added has no picture here, and the page draws
 * their initials instead. Nothing waits on it.
 */
export interface MemberFace {
  sub: string
  name: string
  picture: string | null
}

/**
 * The `picture` claim, as a URL this site is willing to put in an `img`. Theta sends an absolute
 * URL today, but a relative one is resolved against Theta itself rather than against us, and
 * anything that is not http(s) — a `data:` or `javascript:` URL — is dropped.
 */
export function pictureUrl(raw: unknown, issuer: string): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const url = new URL(raw.trim(), issuer)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch { return null }
}

/** Remembers a member as Theta just described them. Called when they log in. */
export function rememberMember(db: Database, who: MemberFace, now = new Date().toISOString()): void {
  db.prepare(`INSERT INTO members (sub, name, picture, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(sub) DO UPDATE SET name = excluded.name, picture = excluded.picture,
      updated_at = excluded.updated_at`)
    .run(who.sub, who.name, who.picture, now)
}

/** The avatars for these subs, those we know of. Unknown subs are simply not in the map. */
export function picturesOf(db: Database, subs: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const want = [...new Set(subs.filter(s => s !== ''))]
  if (want.length === 0) return out
  const rows = db.prepare(`SELECT sub, picture FROM members WHERE sub IN (${want.map(() => '?').join(',')})`)
    .all(...want) as { sub: string; picture: string | null }[]
  for (const r of rows) if (r.picture) out.set(r.sub, r.picture)
  return out
}

/**
 * Puts a face on everyone in one go: one query for the whole page, rather than one per comment.
 * `faces.of` is the same map read again for each person, so the caller cannot forget someone.
 */
export function faces(db: Database, subs: string[]) {
  const pictures = picturesOf(db, subs)
  return {
    of: <T extends FestPerson>(who: T): T & FestFace => ({ ...who, picture: pictures.get(who.sub) ?? null }),
  }
}

/**
 * Who you are, for the top bar: the name and the face of the session reading the page. It is on
 * every page of the site, so it answers from the session cookie and one row, and never caches —
 * the whole point of it is to be right about who is logged in.
 */
export function registerMe(app: FastifyInstance, db: Database): void {
  app.get('/api/me', async (req, reply) => {
    const who = req.member!
    reply.header('Cache-Control', 'no-store')
    return { sub: who.sub, name: who.name, picture: picturesOf(db, [who.sub]).get(who.sub) ?? null }
  })
}
