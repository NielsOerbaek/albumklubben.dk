import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildClubLayout, type ClubLayout } from '../../web/src/klubhus/layout.ts'
import type { Box2 } from '../../web/src/ps1/collide.ts'
import { GENRE_ORDER, genreFamily } from '../../shared/genre.ts'
import type { Album, Archive, Meeting } from '../../shared/types.ts'

const archive: Archive = JSON.parse(readFileSync(new URL('../fixtures/archive.json', import.meta.url), 'utf8'))
const allAlbums = archive.meetings.flatMap((m) => m.albums)
const genreCrates = (l: ClubLayout) => l.crates.filter((c) => c.id !== 'nyt')

/** Meetings with the given album counts, numbered from 1, cycling through the fixture's albums. */
function meetings(counts: number[]): Meeting[] {
  let id = 0
  return counts.map((count, i) => ({
    id: i + 1, number: i + 1, date: null, time: null, theme: null, posters: [],
    albums: Array.from({ length: count }, (_, p): Album => {
      const a = allAlbums[id % allAlbums.length]
      return { ...a, id: ++id, meetingId: i + 1, position: p + 1 }
    }),
  }))
}

const cases: [string, Meeting[]][] = [
  ['0 albums', []],
  ['1 album', meetings([1])],
  ['the 44-album seed', archive.meetings],
  ['300 albums', meetings(Array.from({ length: 30 }, () => 10))],
]
const WALLS = 4 // the first four boxes are the walls, just outside the room
const overlap = (a: Box2, b: Box2) =>
  a.minX < b.maxX - 1e-9 && b.minX < a.maxX - 1e-9 && a.minZ < b.maxZ - 1e-9 && b.minZ < a.maxZ - 1e-9
const inside = (b: Box2, l: ClubLayout) =>
  b.minX >= -l.width / 2 - 1e-9 && b.maxX <= l.width / 2 + 1e-9 && b.minZ >= -l.length / 2 - 1e-9 && b.maxZ <= l.length / 2 + 1e-9

describe('buildClubLayout', () => {
  it('puts every solid box inside the room and none overlapping', () => {
    for (const [name, ms] of cases) {
      const l = buildClubLayout(ms)
      expect(l.length, name).toBeGreaterThanOrEqual(l.width * 2)
      for (const b of l.boxes.slice(WALLS)) expect(inside(b, l), name).toBe(true)
      for (const [i, a] of l.boxes.entries()) {
        for (const b of l.boxes.slice(i + 1)) expect(overlap(a, b), `${name} ${i}`).toBe(false)
      }
      for (const b of [l.windowBench, l.table, l.stairs, l.coffeeTable, ...l.sofa, ...l.chairs, ...l.columns.map((c) => ({
        minX: c.x - 0.225, maxX: c.x + 0.225, minZ: c.z - 0.225, maxZ: c.z + 0.225 }))]) {
        expect(l.boxes, name).toContainEqual(b)
      }
    }
  })

  it('keeps the spawn clear of every box and the walkway between table and sofas at least 1.2 m wide', () => {
    for (const [name, ms] of cases) {
      const l = buildClubLayout(ms)
      const r = 0.3
      const { x, z } = l.spawn
      for (const b of l.boxes) expect(x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r, name).toBe(true)
      expect(l.spawn.z).toBeGreaterThan(l.length / 4)
      expect(l.spawn.yaw).toBe(0)
      const zone = Math.min(...[...l.sofa, ...l.chairs, l.coffeeTable].map((b) => b.minX))
      expect(zone - l.table.maxX, name).toBeGreaterThanOrEqual(1.2)
    }
  })

  it('stands every genre crate on the table in GENRE_ORDER, facing +X, the Nyt crate nearest the door', () => {
    const l = buildClubLayout(archive.meetings)
    expect(l.crates[0].id).toBe('nyt')
    const m22 = archive.meetings.find((m) => m.number === 22)!
    expect(l.crates[0].albums.map((a) => a.id)).toEqual(m22.albums.map((a) => a.id))
    expect(genreCrates(l).flatMap((c) => c.albums)).toHaveLength(44)
    const families = genreCrates(l).map((c) => genreFamily(c.albums[0].genre))
    expect(families).toEqual([...families].sort((a, b) => GENRE_ORDER.indexOf(a) - GENRE_ORDER.indexOf(b)))
    for (const c of l.crates) {
      expect(c.rotationY).toBeCloseTo(Math.PI / 2)
      expect(c.albums.length).toBeLessThanOrEqual(12)
      expect(c.x).toBeGreaterThan(l.table.minX)
      expect(c.x).toBeLessThan(l.table.maxX)
      expect(c.z).toBeGreaterThan(l.table.minZ)
      expect(c.z).toBeLessThan(l.table.maxZ)
    }
    for (let i = 1; i < l.crates.length; i++) expect(l.crates[i].z).toBeLessThan(l.crates[i - 1].z)
    expect(l.crates[0].z).toBeGreaterThan(l.length / 2 - 6)
    for (const [name, ms] of cases) {
      const lo = buildClubLayout(ms)
      if (!lo.latest) expect(lo.crates, name).toHaveLength(0)
    }
  })

  it('lengthens the table and the room as albums arrive, never shortening', () => {
    const all = meetings(Array.from({ length: 30 }, () => 10))
    let prevLen = 0
    let prevTable = 0
    const grown: number[] = []
    for (let n = 0; n <= 300; n++) {
      const some = all.map((m, i) => ({ ...m, albums: m.albums.slice(0, Math.max(0, Math.min(10, n - i * 10))) }))
      const l = buildClubLayout(some)
      const t = l.table.maxZ - l.table.minZ
      expect(l.length).toBeGreaterThanOrEqual(prevLen)
      expect(t).toBeGreaterThanOrEqual(prevTable)
      prevLen = l.length
      prevTable = t
      grown.push(l.length)
    }
    expect(grown[300]).toBeGreaterThan(grown[0])
  })

  it('lies the book on the table\'s far end, off every crate', () => {
    for (const [name, ms] of cases) {
      const l = buildClubLayout(ms)
      const b = { minX: l.book.x - l.book.w / 2, maxX: l.book.x + l.book.w / 2, minZ: l.book.z - l.book.d / 2, maxZ: l.book.z + l.book.d / 2 }
      expect(b.minX, name).toBeGreaterThanOrEqual(l.table.minX)
      expect(b.maxX, name).toBeLessThanOrEqual(l.table.maxX)
      expect(b.minZ, name).toBeGreaterThanOrEqual(l.table.minZ)
      expect(b.minZ - l.table.minZ, name).toBeLessThan(0.5)
      for (const c of l.crates) {
        expect(overlap(b, { minX: c.x - 0.3, maxX: c.x + 0.3, minZ: c.z - 0.3, maxZ: c.z + 0.3 }), name).toBe(false)
        expect(c.z, name).toBeGreaterThan(b.maxZ)
      }
    }
  })

  it('keeps a free wall of at least 1.5 m near the door', () => {
    for (const [name, ms] of cases) {
      const l = buildClubLayout(ms)
      const f = l.freeWall
      expect(f.wall).toBe('+X')
      expect(f.to - f.from, name).toBeGreaterThanOrEqual(1.5)
      expect(f.to, name).toBeGreaterThan(l.length / 2 - 4)
      for (const s of l.shelves) expect(s.z1 <= f.from || s.z0 >= f.to, name).toBe(true)
    }
  })

  it('tiles the floor collage between table and sofas without overlap, from the club\'s images', () => {
    for (const [name, ms] of cases) {
      const l = buildClubLayout(ms)
      const urls = new Set(ms.flatMap((m) => [...m.albums.map((a) => a.coverUrl), ...m.posters.map((p) => p.imageUrl)]))
      const zone = Math.min(...[...l.sofa, ...l.chairs, l.coffeeTable].map((b) => b.minX))
      for (const r of l.floorCollage) {
        expect(urls.has(r.imageUrl), name).toBe(true)
        expect(r.w).toBeGreaterThanOrEqual(0.8)
        expect(r.w).toBeLessThanOrEqual(1.6)
        expect(r.d).toBeGreaterThanOrEqual(0.8)
        expect(r.d).toBeLessThanOrEqual(1.6)
        expect(r.x - r.w / 2).toBeGreaterThanOrEqual(l.table.maxX)
        expect(r.x + r.w / 2).toBeLessThanOrEqual(zone)
        expect(Math.abs(r.z) + r.d / 2).toBeLessThanOrEqual(l.length / 2)
      }
      const rects = l.floorCollage.map((r) => ({ minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2 }))
      for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) expect(overlap(a, b), name).toBe(false)
      expect(buildClubLayout(ms).floorCollage, name).toEqual(l.floorCollage)
    }
    expect(buildClubLayout(archive.meetings).floorCollage.length).toBeGreaterThan(4)
    expect(buildClubLayout([]).floorCollage).toHaveLength(0)
  })
})
