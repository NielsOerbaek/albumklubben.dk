import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildMuseumLayout, PLAQUE, type MuseumLayout } from '../../web/src/museum/layout.ts'
import type { Archive, Meeting } from '../../shared/types.ts'

const archive: Archive = JSON.parse(readFileSync(new URL('../fixtures/archive.json', import.meta.url), 'utf8'))
const allPosters = archive.meetings.flatMap((m) => m.posters)
const allAlbums = archive.meetings.flatMap((m) => m.albums)

/** Everything hung on a wall, as rectangles: `u` runs along the wall, `y` up it. */
function rects(l: MuseumLayout) {
  const things = [
    ...l.items.map((i) => ({ ...i, label: `${i.kind} ${i.meetingNumber}` })),
    ...l.plaques.map((p) => ({ ...p, width: PLAQUE.w, height: PLAQUE.h, label: `plaque ${p.meetingNumber}` })),
  ]
  return things.map((t) => ({
    label: t.label,
    wall: `${t.normalX},${t.normalZ},${(t.normalX ? t.x : t.z).toFixed(2)}`,
    u: t.normalX ? t.z : t.x, y: t.y, w: t.width, h: t.height,
  }))
}

function expectNoOverlap(l: MuseumLayout) {
  const all = rects(l)
  for (const [i, a] of all.entries()) {
    for (const b of all.slice(i + 1)) {
      if (a.wall !== b.wall) continue
      const apart = Math.abs(a.u - b.u) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2
      expect(apart, `${a.label} overlaps ${b.label}`).toBe(true)
    }
  }
}

function expectInsideHalls(l: MuseumLayout) {
  for (const t of [...l.items, ...l.plaques]) {
    const hall = l.halls.find((h) => h.meetingNumbers.includes(t.meetingNumber))!
    expect(t.x).toBeGreaterThanOrEqual(hall.bounds.minX)
    expect(t.x).toBeLessThanOrEqual(hall.bounds.maxX)
    expect(t.z).toBeGreaterThanOrEqual(hall.bounds.minZ)
    expect(t.z).toBeLessThanOrEqual(hall.bounds.maxZ)
  }
  // The spawn point is free to stand on.
  const r = 0.3
  const { x, z } = l.spawn
  for (const b of l.boxes) expect(x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r).toBe(true)
}

const emptied = (n: number): Meeting[] =>
  archive.meetings.map((m) => (m.number === n ? { ...m, posters: [], albums: [] } : m))

describe('buildMuseumLayout', () => {
  const museum = buildMuseumLayout(archive.meetings)

  it('every poster appears exactly once', () => {
    const ids = museum.items.filter((i) => i.kind === 'poster').map((i) => i.poster!.id)
    expect(ids.sort((a, b) => a - b)).toEqual(allPosters.map((p) => p.id).sort((a, b) => a - b))
  })

  it('every album appears exactly once as a cover', () => {
    const ids = museum.items.filter((i) => i.kind === 'cover').map((i) => i.album!.id)
    expect(ids.sort((a, b) => a - b)).toEqual(allAlbums.map((a) => a.id).sort((a, b) => a - b))
  })

  it('halls follow meeting order', () => {
    expect(museum.halls[0]).toMatchObject({ title: 'Albumklubben Museum', meetingNumbers: [] })
    expect(museum.halls.flatMap((h) => h.meetingNumbers)).toEqual(archive.meetings.map((m) => m.number))
    // Joined in a line: each hall starts past the one before it.
    for (const [i, h] of museum.halls.entries()) {
      if (i) expect(h.bounds.minX).toBeGreaterThan(museum.halls[i - 1].bounds.maxX)
    }
    expectInsideHalls(museum)
  })

  it('meetings 14, 15, 16 form one hall titled "Nostalgialbums"', () => {
    expect(museum.halls.find((h) => h.meetingNumbers.includes(14))).toMatchObject(
      { title: 'Nostalgialbums', meetingNumbers: [14, 15, 16] })
    // Each run is its own hall: 19 and 21-22 are later runs with the same theme.
    expect(museum.halls.filter((h) => h.title === 'Nostalgialbums').map((h) => h.meetingNumbers))
      .toEqual([[14, 15, 16], [19], [21, 22]])
  })

  it('meetings 1-4 form a hall titled "Møde 1-4"', () => {
    expect(museum.halls[1]).toMatchObject({ title: 'Møde 1-4', meetingNumbers: [1, 2, 3, 4] })
    expect(museum.halls.map((h) => h.title)).toEqual([
      'Albumklubben Museum', 'Møde 1-4', 'Møde 5-8', 'Møde 9-10', 'Bollywood & Robert Plant',
      'Drake vs. Kendrick', 'Wuthering Heights x2', 'Nostalgialbums', 'Club Culture vs. Pink Pop',
      'Troye Sivan & Horse Lords', 'Nostalgialbums', 'Møde 20', 'Nostalgialbums',
    ])
  })

  it('plaque for meeting 17 is [\'Møde 17\', \'d. 18. august 2026\', \'Club Culture vs. Pink Pop\'] and for meeting 1 is [\'Møde 1\']', () => {
    const lines = (n: number) => museum.plaques.find((p) => p.meetingNumber === n)!.lines
    expect(lines(17)).toEqual(['Møde 17', 'd. 18. august 2026', 'Club Culture vs. Pink Pop'])
    expect(lines(1)).toEqual(['Møde 1'])
    expect(lines(11)).toEqual(['Møde 11', 'd. 21. april 2026', 'Bollywood & Robert Plant'])
    expect(lines(14)).toEqual(['Møde 14', 'Nostalgialbums'])
    expect(museum.plaques.map((p) => p.meetingNumber).sort((a, b) => a - b)).toEqual(archive.meetings.map((m) => m.number))
    for (const p of museum.plaques) for (const l of p.lines) expect(l).not.toMatch(/null|undefined/)
  })

  it('items on the same wall do not overlap', () => {
    expectNoOverlap(museum)
    // Odd shapes: 3 albums, 1 album and no posters, 4 posters and no albums.
    const odd = archive.meetings.map((m) => m.number === 2
      ? { ...m, albums: [...m.albums, { ...allAlbums[0], id: 999 }] }
      : m.number === 3 ? { ...m, albums: m.albums.slice(0, 1) }
      : m.number === 17 ? { ...m, albums: [], posters: [...m.posters, { ...m.posters[0], id: 998 }] }
      : m)
    const l = buildMuseumLayout(odd)
    expectNoOverlap(l)
    expectInsideHalls(l)
  })

  it('a meeting with 0 posters and 0 albums adds no section', () => {
    const l = buildMuseumLayout(emptied(3))
    expect(l.items.some((i) => i.meetingNumber === 3)).toBe(false)
    expect(l.plaques.some((p) => p.meetingNumber === 3)).toBe(false)
    expect(l.halls[1]).toMatchObject({ title: 'Møde 1-5', meetingNumbers: [1, 2, 4, 5] })
    // An empty archive is just the entrance hall.
    const empty = buildMuseumLayout([])
    expect(empty.halls.map((h) => h.title)).toEqual(['Albumklubben Museum'])
    expect(empty.items).toEqual([])
    expectInsideHalls(empty)
  })

  it('hangs posters 1.4 m tall at the image aspect, else 1.4 × 0.79', () => {
    const p = allPosters[0]
    const at = (l: MuseumLayout) => l.items.find((i) => i.poster?.id === p.id)!
    expect(at(museum)).toMatchObject({ height: 1.4 })
    expect(at(museum).width).toBeCloseTo(0.79, 2)
    expect(at(buildMuseumLayout(archive.meetings, new Map([[p.id, 1.5]]))).width).toBeCloseTo(2.1)
    for (const c of museum.items.filter((i) => i.kind === 'cover')) expect([c.width, c.height]).toEqual([0.5, 0.5])
  })

  it('a hall grows with its content', () => {
    const hallOf = (l: MuseumLayout) => l.halls.find((h) => h.meetingNumbers.includes(17))!.bounds
    const more = archive.meetings.map((m) => m.number === 17
      ? { ...m, posters: Array.from({ length: 12 }, (_, i) => ({ ...m.posters[0], id: 500 + i })) }
      : m)
    const length = (b: { minX: number; maxX: number }) => b.maxX - b.minX
    expect(length(hallOf(buildMuseumLayout(more)))).toBeGreaterThan(length(hallOf(museum)) + 5)
  })
})
