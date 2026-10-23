import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildShopLayout, type ShopLayout } from '../../web/src/crate/layout.ts'
import { genreFamily } from '../../shared/genre.ts'
import type { Album, Archive, Meeting } from '../../shared/types.ts'

const archive: Archive = JSON.parse(readFileSync(new URL('../fixtures/archive.json', import.meta.url), 'utf8'))
const allAlbums = archive.meetings.flatMap((m) => m.albums)
const genreCrates = (l: ShopLayout) => l.crates.filter((c) => c.id !== 'nyt')

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

function expectSound(l: ShopLayout, albums: Album[]) {
  const ids = genreCrates(l).flatMap((c) => c.albums.map((a) => a.id)).sort((a, b) => a - b)
  expect(ids).toEqual(albums.map((a) => a.id).sort((a, b) => a - b))
  for (const c of l.crates) {
    expect(c.albums.length).toBeLessThanOrEqual(12)
    expect(Math.abs(c.x)).toBeLessThanOrEqual(l.width / 2)
    expect(Math.abs(c.z)).toBeLessThanOrEqual(l.depth / 2)
  }
  for (const [i, a] of l.crates.entries()) {
    for (const b of l.crates.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.6)
  }
  // The spawn point is free to stand on.
  const r = 0.3
  const { x, z } = l.spawn
  for (const b of l.boxes) expect(x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r).toBe(true)
}

describe('buildShopLayout', () => {
  const shop = buildShopLayout(archive.meetings)

  it('first crate is Nyt with meeting 22\'s two albums', () => {
    const [nyt] = shop.crates
    expect(nyt.label).toBe('Nyt')
    const m22 = archive.meetings.find((m) => m.number === 22)!
    expect(nyt.albums.map((a) => a.id)).toEqual(m22.albums.map((a) => a.id))
    expect(m22.albums).toHaveLength(2)
  })

  it('every album appears in exactly one genre crate', () => {
    const ids = genreCrates(shop).flatMap((c) => c.albums.map((a) => a.id))
    expect(ids).toHaveLength(44)
    expect(new Set(ids)).toEqual(new Set(allAlbums.map((a) => a.id)))
    const meetingOf = new Map(archive.meetings.flatMap((m) => m.albums.map((a) => [a.id, m.number])))
    for (const c of genreCrates(shop)) {
      const family = c.label.replace(/ \d+$/, '')
      for (const a of c.albums) expect(genreFamily(a.genre)).toBe(family)
      const numbers = c.albums.map((a) => meetingOf.get(a.id)!)
      expect(numbers).toEqual([...numbers].sort((a, b) => b - a))
    }
  })

  it('no crate holds more than 12 records', () => {
    for (const c of shop.crates) expect(c.albums.length).toBeLessThanOrEqual(12)
    // Overflow continues in "<family> 2".
    const big = buildShopLayout(meetings(Array(15).fill(2)).map((m) => ({
      ...m, albums: m.albums.map((a) => ({ ...a, genre: 'Pop' })),
    })))
    expect(genreCrates(big).map((c) => [c.label, c.albums.length])).toEqual([['Pop', 12], ['Pop 2', 12], ['Pop 3', 6]])
  })

  it('crates do not overlap and lie inside the room', () => {
    expect(shop.width).toBeGreaterThanOrEqual(10)
    expect(shop.depth).toBeGreaterThanOrEqual(8)
    expectSound(shop, allAlbums)
  })

  it('handles odd shapes', () => {
    const odd = meetings([0, 1, 3])
    const l = buildShopLayout(odd)
    expect(l.crates[0].label).toBe('Nyt')
    expect(l.crates[0].albums).toHaveLength(3)
    expectSound(l, odd.flatMap((m) => m.albums))
    // The latest meeting has no albums yet: Nyt is the newest one that has.
    const l2 = buildShopLayout(meetings([2, 1, 0]))
    expect(l2.crates[0].albums.map((a) => a.meetingId)).toEqual([2])
    // An empty archive is an empty shop.
    const empty = buildShopLayout(meetings([0]))
    expect(empty.crates).toEqual([])
    expect(empty.boxes.length).toBeGreaterThan(0)
  })

  it('room grows', () => {
    const many = meetings(Array(100).fill(2))
    const l = buildShopLayout(many)
    expect(l.width * l.depth).toBeGreaterThan(shop.width * shop.depth)
    expectSound(l, many.flatMap((m) => m.albums))
  })
})
