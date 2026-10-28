import type { Database } from './db.ts'
import type { BoardPost } from '../shared/board.ts'
import type { FestAlbum, FestCommentRow, FestPerson, FestSummary, FestTrack } from '../shared/lyttefest.ts'

type BoardPostFest = NonNullable<BoardPost['lyttefest']>

/** The lyttefest tables. Everything the site knows about a listening party lives here. */
type Row = Record<string, any>

export interface FestRow {
  id: number
  albumId: number
  host: FestPerson
  startsAt: string
  note: string | null
  tracks: FestTrack[]
  thetaPostId: string | null
  thetaPostUrl: string | null
  cardExternalId: string | null
  postedAs: 'user' | 'app'
  cancelledAt: string | null
  remindedAt: string | null
  summaryPostedAt: string | null
  createdAt: string
}

const toFest = (r: Row): FestRow => ({
  id: r.id,
  albumId: r.album_id,
  host: { sub: r.host_sub, name: r.host_name },
  startsAt: r.starts_at,
  note: r.note,
  tracks: JSON.parse(r.tracks) as FestTrack[],
  thetaPostId: r.theta_post_id,
  thetaPostUrl: r.theta_post_url,
  cardExternalId: r.card_external_id,
  postedAs: r.posted_as,
  cancelledAt: r.cancelled_at,
  remindedAt: r.reminded_at,
  summaryPostedAt: r.summary_posted_at,
  createdAt: r.created_at,
})

const toComment = (r: Row): FestCommentRow => ({
  id: r.id, sub: r.sub, name: r.name, trackIndex: r.track_index, text: r.text, createdAt: r.created_at,
})

export interface NewFest {
  albumId: number
  host: FestPerson
  startsAt: string
  note: string | null
  tracks: FestTrack[]
}

export function createFest(db: Database, f: NewFest, now = new Date().toISOString()): number {
  return Number(db.prepare(`INSERT INTO lyttefester
    (album_id, host_sub, host_name, starts_at, note, tracks, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(f.albumId, f.host.sub, f.host.name, f.startsAt, f.note, JSON.stringify(f.tracks), now).lastInsertRowid)
}

export const getFest = (db: Database, id: number): FestRow | null => {
  const row = db.prepare('SELECT * FROM lyttefester WHERE id = ?').get(id) as Row | undefined
  return row ? toFest(row) : null
}

/** Where the announcement in the group ended up, so it can be updated later. */
export function setFestPost(db: Database, id: number, post: {
  thetaPostId: string | null; thetaPostUrl: string | null; cardExternalId: string; postedAs: 'user' | 'app'
}): void {
  db.prepare('UPDATE lyttefester SET theta_post_id = ?, theta_post_url = ?, card_external_id = ?, posted_as = ? WHERE id = ?')
    .run(post.thetaPostId, post.thetaPostUrl, post.cardExternalId, post.postedAs, id)
}

export const moveFest = (db: Database, id: number, startsAt: string): void => {
  // A new time means the reminder has not been sent for it.
  db.prepare('UPDATE lyttefester SET starts_at = ?, reminded_at = NULL WHERE id = ?').run(startsAt, id)
}

export const cancelFest = (db: Database, id: number, at = new Date().toISOString()): void => {
  db.prepare('UPDATE lyttefester SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL').run(at, id)
}

/** Marks a one-off job done, and says whether this call was the one that did it. */
export function markOnce(db: Database, id: number, column: 'reminded_at' | 'summary_posted_at',
  at = new Date().toISOString()): boolean {
  return db.prepare(`UPDATE lyttefester SET ${column} = ? WHERE id = ? AND ${column} IS NULL`)
    .run(at, id).changes > 0
}

/** The lyttefester whose reminder is still owed, so they can be put back on the clock at start-up. */
export const pendingReminders = (db: Database): FestRow[] =>
  (db.prepare('SELECT * FROM lyttefester WHERE reminded_at IS NULL AND cancelled_at IS NULL').all() as Row[]).map(toFest)

/** The ones that are over but have not had their summary posted yet. */
export const pendingSummaries = (db: Database): FestRow[] =>
  (db.prepare('SELECT * FROM lyttefester WHERE summary_posted_at IS NULL AND cancelled_at IS NULL').all() as Row[]).map(toFest)

export const listFestsForAlbum = (db: Database, albumId: number): FestSummary[] =>
  (db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM lyttefest_rsvps r WHERE r.lyttefest_id = f.id) AS coming
    FROM lyttefester f WHERE f.album_id = ? ORDER BY f.starts_at DESC`).all(albumId) as Row[])
    .map(r => ({
      id: r.id, startsAt: r.starts_at, cancelled: r.cancelled_at !== null,
      host: { sub: r.host_sub, name: r.host_name }, coming: r.coming,
    }))

/** The lyttefest the room's screen should show: the one running, or the next one coming up. */
export function currentFest(db: Database, now = new Date().toISOString()): FestRow | null {
  const soon = db.prepare(`SELECT * FROM lyttefester WHERE cancelled_at IS NULL AND starts_at >= ?
    ORDER BY starts_at LIMIT 1`).get(now) as Row | undefined
  const running = db.prepare(`SELECT * FROM lyttefester WHERE cancelled_at IS NULL AND starts_at < ?
    ORDER BY starts_at DESC LIMIT 1`).get(now) as Row | undefined
  // Whether the one that has started is still playing is for the caller's clock to say.
  return running ? toFest(running) : soon ? toFest(soon) : null
}

export const festsFrom = (db: Database, from: string): FestRow[] =>
  (db.prepare('SELECT * FROM lyttefester WHERE starts_at >= ? ORDER BY starts_at').all(from) as Row[]).map(toFest)

// --- Who is coming -----------------------------------------------------------------------------

export function setRsvp(db: Database, id: number, who: FestPerson, coming: boolean,
  now = new Date().toISOString()): void {
  if (coming) {
    db.prepare(`INSERT INTO lyttefest_rsvps (lyttefest_id, sub, name, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(lyttefest_id, sub) DO UPDATE SET name = excluded.name`).run(id, who.sub, who.name, now)
  } else {
    db.prepare('DELETE FROM lyttefest_rsvps WHERE lyttefest_id = ? AND sub = ?').run(id, who.sub)
  }
}

export const listRsvps = (db: Database, id: number): FestPerson[] =>
  (db.prepare('SELECT sub, name FROM lyttefest_rsvps WHERE lyttefest_id = ? ORDER BY created_at').all(id) as Row[])
    .map(r => ({ sub: r.sub, name: r.name }))

export const isComing = (db: Database, id: number, sub: string): boolean =>
  db.prepare('SELECT 1 FROM lyttefest_rsvps WHERE lyttefest_id = ? AND sub = ?').get(id, sub) !== undefined

// --- What was said ------------------------------------------------------------------------------

export function addComment(db: Database, id: number, who: FestPerson, text: string,
  trackIndex: number | null, now = new Date().toISOString()): FestCommentRow {
  const insert = db.prepare(`INSERT INTO lyttefest_comments
    (lyttefest_id, sub, name, track_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, who.sub, who.name, trackIndex, text, now)
  return { id: Number(insert.lastInsertRowid), sub: who.sub, name: who.name, trackIndex, text, createdAt: now }
}

export const listComments = (db: Database, id: number): FestCommentRow[] =>
  (db.prepare(`SELECT * FROM lyttefest_comments WHERE lyttefest_id = ? AND deleted_at IS NULL
    ORDER BY created_at, id`).all(id) as Row[]).map(toComment)

/** A comment is taken down by whoever wrote it, or by the host. It is kept, only hidden. */
export function deleteComment(db: Database, id: number, commentId: number, by: string, hostSub: string,
  now = new Date().toISOString()): boolean {
  return db.prepare(`UPDATE lyttefest_comments SET deleted_at = ?
    WHERE id = ? AND lyttefest_id = ? AND deleted_at IS NULL AND (sub = ? OR ? = ?)`)
    .run(now, commentId, id, by, by, hostSub).changes > 0
}

/** The album a lyttefest is for, with the number of the meeting it was played at. */
export function festAlbum(db: Database, albumId: number): FestAlbum | null {
  const r = db.prepare(`SELECT a.*, m.number AS meeting_number FROM albums a
    JOIN meetings m ON m.id = a.meeting_id WHERE a.id = ?`).get(albumId) as Row | undefined
  if (!r) return null
  return {
    id: r.id, artist: r.artist, title: r.title, year: r.year,
    coverUrl: r.cover_path === null ? null : `/uploads/${r.cover_path}`,
    cardColor: r.card_color, meetingNumber: r.meeting_number,
  }
}

/** The lyttefester announced by the given Theta posts, so the board can show them as such. */
export function festsByPost(db: Database, postIds: string[]): Map<string, BoardPostFest> {
  const out = new Map<string, BoardPostFest>()
  if (postIds.length === 0) return out
  const rows = db.prepare(`SELECT id, album_id, theta_post_id FROM lyttefester
    WHERE theta_post_id IN (${postIds.map(() => '?').join(',')})`).all(...postIds) as Row[]
  for (const r of rows) {
    const album = festAlbum(db, r.album_id)
    if (album) {
      out.set(String(r.theta_post_id),
        { id: r.id, artist: album.artist, title: album.title, coverUrl: album.coverUrl })
    }
  }
  return out
}

export const albumTracklist = (db: Database, albumId: number): string | null => {
  const r = db.prepare('SELECT tracklist FROM albums WHERE id = ?').get(albumId) as Row | undefined
  return r ? r.tracklist : null
}
