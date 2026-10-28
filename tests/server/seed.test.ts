import {cpSync, existsSync, writeFileSync} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../../server/db.ts'
import { listMeetings } from '../../server/repo.ts'
import { seed } from '../../server/seed.ts'
import { tmp } from '../tmp.ts'

// The seed data (data/: the Figma export with covers, posters and the members' picks) is
// kept out of git. Point ALBUMKLUBBEN_DATA at a copy to run these; without one they skip.
const DATA = process.env.ALBUMKLUBBEN_DATA ?? 'data'

const setup = () => {
  const uploadDir = tmp('seed-')
  const db = openDb(':memory:')
  return { db, uploadDir, result: seed(db, DATA, uploadDir) }
}

describe.skipIf(!existsSync(join(DATA, 'albums.json')))('seed', () => {
  it('seeds 22 meetings, 44 albums and 18 posters', () => {
    expect(setup().result).toEqual({ meetings: 22, albums: 44, posters: 18 })
  })

  it('maps fields', () => {
    const { db } = setup()
    const ms = listMeetings(db)
    const a = ms.find(m => m.number === 21)!.albums[0]
    expect(a).toMatchObject({
      artist: 'Jeff Buckley', title: 'Grace', year: 1994, cardColor: '#262d66',
    })
    expect(a.pickedByName).toBeTruthy()
    expect(a.pickedByWorkplace).toBeTruthy()
    expect(a.story).toMatch(new RegExp(`^Jeg hedder ${a.pickedByName}`))
    expect(ms.find(m => m.number === 17)).toMatchObject({
      date: '2026-08-18', time: '11:30-12:30', theme: 'Club Culture vs. Pink Pop',
    })
    expect(ms.find(m => m.number === 1)).toMatchObject({ date: null, theme: null })
  })

  it('copies every referenced file', () => {
    const { db, uploadDir } = setup()
    for (const m of listMeetings(db)) {
      for (const a of m.albums) expect(existsSync(join(uploadDir, a.coverUrl!.replace('/uploads/', '')))).toBe(true)
      for (const p of m.posters) expect(existsSync(join(uploadDir, p.imageUrl.replace('/uploads/', '')))).toBe(true)
    }
  })

  it('refuses a non-empty database', () => {
    const { db, uploadDir } = setup()
    expect(() => seed(db, DATA, uploadDir)).toThrow('Databasen er ikke tom')
  })

  it('applies tracklists.json by exact artist and title', () => {
    const dataDir = tmp('seed-data-')
    cpSync(DATA, dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'tracklists.json'), JSON.stringify([
      { artist: 'Jeff Buckley', title: 'Grace', tracklist: 'Mojo Pin 5:42\nGrace 5:22', release: 'x' },
    ]))
    const db = openDb(':memory:')
    seed(db, dataDir, tmp('seed-'))
    const all = listMeetings(db).flatMap(m => m.albums)
    expect(all.find(a => a.title === 'Grace')!.tracklist).toBe('Mojo Pin 5:42\nGrace 5:22')
    expect(all.filter(a => a.tracklist !== null)).toHaveLength(1)
  })
})
