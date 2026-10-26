import type { Database } from './db.ts'
import type {
  Album, AlbumInput, Meeting, MeetingInput, Poster, PosterInput,
} from '../shared/types.ts'

const url = (p: string | null) => (p === null ? null : `/uploads/${p}`)

type Row = Record<string, any>

const toAlbum = (r: Row): Album => ({
  id: r.id, meetingId: r.meeting_id, position: r.position, artist: r.artist, title: r.title,
  year: r.year, origin: r.origin, country: r.country, lat: r.lat, lng: r.lng, genre: r.genre,
  gender: r.gender, status: r.status, pickedByName: r.picked_by_name,
  pickedByWorkplace: r.picked_by_workplace, story: r.story, cardColor: r.card_color,
  coverUrl: url(r.cover_path), tracklist: r.tracklist,
})

const toPoster = (r: Row): Poster => ({
  id: r.id, meetingId: r.meeting_id, position: r.position, imageUrl: url(r.image_path)!,
  caption: r.caption, about: r.about, videoUrl: url(r.video_path),
})

function load(db: Database, where: string, ...args: number[]): Meeting[] {
  const meetings = db.prepare(`SELECT * FROM meetings ${where} ORDER BY number`).all(...args) as Row[]
  const albums = db.prepare('SELECT * FROM albums ORDER BY position').all() as Row[]
  const posters = db.prepare('SELECT * FROM posters ORDER BY position').all() as Row[]
  return meetings.map(m => ({
    id: m.id, number: m.number, date: m.date, time: m.time, theme: m.theme,
    albums: albums.filter(a => a.meeting_id === m.id).map(toAlbum),
    posters: posters.filter(p => p.meeting_id === m.id).map(toPoster),
  }))
}

export const listMeetings = (db: Database): Meeting[] => load(db, '')
export const getMeeting = (db: Database, id: number): Meeting | undefined => load(db, 'WHERE id = ?', id)[0]
export const isEmpty = (db: Database): boolean =>
  db.prepare('SELECT 1 FROM meetings LIMIT 1').get() === undefined

const nextPosition = (db: Database, table: 'albums' | 'posters', meetingId: number): number =>
  (db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${table} WHERE meeting_id = ?`)
    .get(meetingId) as { p: number }).p

export function createMeeting(db: Database, i: MeetingInput): number {
  return Number(db.prepare('INSERT INTO meetings (number, date, time, theme) VALUES (?, ?, ?, ?)')
    .run(i.number, i.date, i.time, i.theme).lastInsertRowid)
}

export function updateMeeting(db: Database, id: number, i: MeetingInput): void {
  db.prepare('UPDATE meetings SET number = ?, date = ?, time = ?, theme = ? WHERE id = ?')
    .run(i.number, i.date, i.time, i.theme, id)
}

const paths = (rows: Row[], ...keys: string[]): string[] =>
  rows.flatMap(r => keys.map(k => r[k] as string | null)).filter((p): p is string => !!p)

export function deleteMeeting(db: Database, id: number): string[] {
  return db.transaction(() => {
    const a = db.prepare('SELECT cover_path FROM albums WHERE meeting_id = ?').all(id) as Row[]
    const p = db.prepare('SELECT image_path, video_path FROM posters WHERE meeting_id = ?').all(id) as Row[]
    db.prepare('DELETE FROM meetings WHERE id = ?').run(id)
    return [...paths(a, 'cover_path'), ...paths(p, 'image_path', 'video_path')]
  })()
}

const ALBUM_COLS = `artist = ?, title = ?, year = ?, origin = ?, country = ?, lat = ?, lng = ?,
  genre = ?, gender = ?, status = ?, picked_by_name = ?, picked_by_workplace = ?, story = ?,
  card_color = ?, cover_path = ?, tracklist = ?`
const albumArgs = (i: AlbumInput) => [i.artist, i.title, i.year, i.origin, i.country, i.lat, i.lng,
  i.genre, i.gender, i.status, i.pickedByName, i.pickedByWorkplace, i.story, i.cardColor, i.coverPath, i.tracklist]

export function createAlbum(db: Database, meetingId: number, i: AlbumInput): number {
  const pos = nextPosition(db, 'albums', meetingId)
  const id = db.prepare(`INSERT INTO albums (meeting_id, position, artist, title, year, origin, country,
    lat, lng, genre, gender, status, picked_by_name, picked_by_workplace, story, card_color, cover_path, tracklist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(meetingId, pos, ...albumArgs(i)).lastInsertRowid
  return Number(id)
}

export function updateAlbum(db: Database, id: number, i: AlbumInput): void {
  db.prepare(`UPDATE albums SET ${ALBUM_COLS} WHERE id = ?`).run(...albumArgs(i), id)
}

export function createPoster(db: Database, meetingId: number, i: PosterInput): number {
  const pos = nextPosition(db, 'posters', meetingId)
  return Number(db.prepare(`INSERT INTO posters (meeting_id, position, image_path, caption, about, video_path)
    VALUES (?, ?, ?, ?, ?, ?)`).run(meetingId, pos, i.imagePath, i.caption, i.about, i.videoPath).lastInsertRowid)
}

export function updatePoster(db: Database, id: number, i: PosterInput): void {
  db.prepare('UPDATE posters SET image_path = ?, caption = ?, about = ?, video_path = ? WHERE id = ?')
    .run(i.imagePath, i.caption, i.about, i.videoPath, id)
}

function remove(db: Database, table: 'albums' | 'posters', id: number, ...cols: string[]): string[] {
  return db.transaction(() => {
    const row = db.prepare(`SELECT meeting_id, position, ${cols.join(', ')} FROM ${table} WHERE id = ?`)
      .get(id) as Row | undefined
    if (!row) return []
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    db.prepare(`UPDATE ${table} SET position = position - 1 WHERE meeting_id = ? AND position > ?`)
      .run(row.meeting_id, row.position)
    return paths([row], ...cols)
  })()
}

export const deleteAlbum = (db: Database, id: number): string[] => remove(db, 'albums', id, 'cover_path')
export const deletePoster = (db: Database, id: number): string[] =>
  remove(db, 'posters', id, 'image_path', 'video_path')

function move(db: Database, table: 'albums' | 'posters', id: number, dir: -1 | 1): void {
  db.transaction(() => {
    const me = db.prepare(`SELECT meeting_id, position FROM ${table} WHERE id = ?`).get(id) as Row | undefined
    if (!me) return
    const other = db.prepare(`SELECT id, position FROM ${table} WHERE meeting_id = ? AND position = ?`)
      .get(me.meeting_id, me.position + dir) as Row | undefined
    if (!other) return
    db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).run(other.position, id)
    db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).run(me.position, other.id)
  })()
}

export const moveAlbum = (db: Database, id: number, dir: -1 | 1): void => move(db, 'albums', id, dir)
export const movePoster = (db: Database, id: number, dir: -1 | 1): void => move(db, 'posters', id, dir)
