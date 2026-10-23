import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { Database } from './db.ts'
import { createAlbum, createMeeting, createPoster, isEmpty, updateAlbum } from './repo.ts'
import type { AlbumInput } from '../shared/types.ts'

const readJson = (dataDir: string, name: string) => JSON.parse(readFileSync(join(dataDir, name), 'utf8'))

function copy(dataDir: string, uploadDir: string, from: string, to: string): string {
  mkdirSync(dirname(join(uploadDir, to)), { recursive: true })
  copyFileSync(join(dataDir, from), join(uploadDir, to))
  return to
}

export function seed(db: Database, dataDir: string, uploadDir: string) {
  if (!isEmpty(db)) throw new Error('Databasen er ikke tom')
  const meetings = readJson(dataDir, 'meetings.json')
  const albums = readJson(dataDir, 'albums.json')
  const counts = { meetings: 0, albums: 0, posters: 0 }

  db.transaction(() => {
    for (const m of meetings) {
      const meetingId = createMeeting(db, { number: m.number, date: m.date, time: m.time, theme: m.theme })
      counts.meetings++
      const picks = albums.filter((a: any) => a.meeting === m.number).sort((a: any, b: any) => a.order - b.order)
      for (const a of picks) {
        const input: AlbumInput = {
          artist: a.artist, title: a.title, year: a.year ?? null, origin: a.origin ?? '',
          country: a.country ?? '', lat: a.location?.lat ?? null, lng: a.location?.lng ?? null,
          genre: a.genre ?? '', gender: a.gender ?? '', status: a.status ?? '',
          pickedByName: a.pickedBy?.name ?? null, pickedByWorkplace: a.pickedBy?.workplace ?? null,
          story: a.story ?? null, cardColor: a.cardColor, coverPath: null,
        }
        const id = createAlbum(db, meetingId, input)
        if (a.cover) input.coverPath = copy(dataDir, uploadDir, a.cover, `covers/${id}${extname(a.cover)}`)
        updateAlbum(db, id, input)
        counts.albums++
      }
      let n = 0
      for (const f of m.media) {
        n++
        const imagePath = copy(dataDir, uploadDir, f.file, `posters/${m.number}-${n}${extname(f.file)}`)
        createPoster(db, meetingId, { imagePath, caption: f.caption ?? null, videoPath: null })
        counts.posters++
      }
    }
  })()
  return counts
}
