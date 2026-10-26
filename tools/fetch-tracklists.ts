// Fills empty album tracklists from MusicBrainz. Usage:
//   pnpm tracklists --db <path> [--cache data/tracklists.json]
// Found tracklists are appended to the cache file (the seed reads it); a non-empty tracklist is never touched.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { openDb } from '../server/db.ts'
import { findTracklist } from '../server/musicbrainz.ts'

type Entry = { artist: string; title: string; tracklist: string; release: string }

const { values } = parseArgs({ options: { db: { type: 'string' }, cache: { type: 'string', default: 'data/tracklists.json' } } })
if (!values.db) {
  console.error('Brug: pnpm tracklists --db <sti> [--cache data/tracklists.json]')
  process.exit(1)
}
const cachePath = values.cache!
const cache: Entry[] = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : []
const db = openDb(values.db)
const albums = db.prepare(`SELECT id, artist, title FROM albums WHERE tracklist IS NULL OR tracklist = '' ORDER BY id`)
  .all() as { id: number; artist: string; title: string }[]
const update = db.prepare(`UPDATE albums SET tracklist = ? WHERE id = ? AND (tracklist IS NULL OR tracklist = '')`)

let ok = 0
let miss = 0
for (const a of albums) {
  let entry = cache.find(c => c.artist === a.artist && c.title === a.title)
  if (!entry) {
    try {
      const found = await findTracklist(a.artist, a.title)
      if (found) {
        entry = { artist: a.artist, title: a.title, ...found }
        cache.push(entry)
        writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n')
      }
    } catch (err) {
      console.log(`MISS ${a.artist} – ${a.title} (${(err as Error).message})`)
      miss++
      continue
    }
  }
  if (entry) {
    update.run(entry.tracklist, a.id)
    console.log(`OK ${a.artist} – ${a.title}: ${entry.release}`)
    ok++
  } else {
    console.log(`MISS ${a.artist} – ${a.title}`)
    miss++
  }
}
console.log(`${ok} OK, ${miss} MISS`)
