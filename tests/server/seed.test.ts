import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../../server/db.ts'
import { listMeetings } from '../../server/repo.ts'
import { seed } from '../../server/seed.ts'

const setup = () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'seed-'))
  const db = openDb(':memory:')
  return { db, uploadDir, result: seed(db, 'data', uploadDir) }
}

describe('seed', () => {
  it('seeds 22 meetings, 44 albums and 18 posters', () => {
    expect(setup().result).toEqual({ meetings: 22, albums: 44, posters: 18 })
  })

  it('maps fields', () => {
    const { db } = setup()
    const ms = listMeetings(db)
    const a = ms.find(m => m.number === 21)!.albums[0]
    expect(a).toMatchObject({
      artist: 'Jeff Buckley', title: 'Grace', year: 1994, cardColor: '#262d66',
      pickedByName: 'Medlem 9', pickedByWorkplace: 'Arbejdsplads B',
    })
    expect(a.story).toMatch(/^Jeg hedder Medlem 9/)
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
    expect(() => seed(db, 'data', uploadDir)).toThrow('Databasen er ikke tom')
  })
})
