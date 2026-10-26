import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildClubLayout, COUCH, type ClubLayout, type PosterSlot } from '../../web/src/klubhus/layout.ts'
import type { Box2 } from '../../web/src/ps1/collide.ts'
import { genreFamily } from '../../shared/genre.ts'
import type { Album, Archive, Meeting, Poster } from '../../shared/types.ts'

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

function expectSound(l: ClubLayout, albums: Album[]) {
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

describe('buildClubLayout', () => {
  const shop = buildClubLayout(archive.meetings)

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
    const big = buildClubLayout(meetings(Array(15).fill(2)).map((m) => ({
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
    const l = buildClubLayout(odd)
    expect(l.crates[0].label).toBe('Nyt')
    expect(l.crates[0].albums).toHaveLength(3)
    expectSound(l, odd.flatMap((m) => m.albums))
    // The latest meeting has no albums yet: Nyt is the newest one that has.
    const l2 = buildClubLayout(meetings([2, 1, 0]))
    expect(l2.crates[0].albums.map((a) => a.meetingId)).toEqual([2])
    // An empty archive is an empty shop.
    const empty = buildClubLayout(meetings([0]))
    expect(empty.crates).toEqual([])
    expect(empty.boxes.length).toBeGreaterThan(0)
  })

  it('room grows', () => {
    const many = meetings(Array(100).fill(2))
    const l = buildClubLayout(many)
    expect(l.width * l.depth).toBeGreaterThan(shop.width * shop.depth)
    expectSound(l, many.flatMap((m) => m.albums))
  })
})

// ---------------------------------------------------------------------------------------------
// The listening corner, the bins and the poster slots.

const EPS = 1e-9
let posterId = 0
const poster = (meetingId: number, position: number, videoUrl: string | null = null): Poster =>
  ({ id: ++posterId, meetingId, position, imageUrl: `/p/${posterId}.jpg`, caption: null, about: null, videoUrl })

/** Twenty meetings of two albums each, `n` posters dealt out over all but the last one, and
 *  `current` posters on the last (the current meeting). */
function withPosters(n: number, current = 0): Meeting[] {
  const ms = meetings(Array(20).fill(2))
  for (let i = 0; i < n; i++) {
    const m = ms[(i * 7) % 19]
    m.posters.push(poster(m.id, m.posters.length + 1))
  }
  for (let i = 0; i < current; i++) ms[19].posters.push(poster(20, i + 1))
  return ms
}

const alongWall = (s: PosterSlot) => (s.wall === 'back' ? s.x : s.z)
const free = (l: ClubLayout, x: number, z: number, r = 0.3) =>
  l.boxes.every((b) => x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r)

/** Grid BFS over the floor at 0.25 m with a 0.3 m player: can you walk from the spawn to the
 *  couch's front side (it faces -Z)? */
function reachesCouch(l: ClubLayout): boolean {
  const step = 0.25, hw = l.width / 2, hd = l.depth / 2
  const nx = Math.floor(l.width / step), nz = Math.floor(l.depth / step)
  const cx = (i: number) => -hw + (i + 0.5) * step, cz = (j: number) => -hd + (j + 0.5) * step
  const start: [number, number] = [Math.floor((l.spawn.x + hw) / step), Math.floor((l.spawn.z + hd) / step)]
  if (!free(l, cx(start[0]), cz(start[1]))) return false
  const seen = new Set([start.join()])
  const queue = [start]
  const c = l.couch
  while (queue.length) {
    const [i, j] = queue.shift()!
    const x = cx(i), z = cz(j)
    if (x >= c.minX && x <= c.maxX && z < c.minZ && z >= c.minZ - 0.6) return true
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen.has(`${a},${b}`) || !free(l, cx(a), cz(b))) continue
      seen.add(`${a},${b}`)
      queue.push([a, b])
    }
  }
  return false
}

function expectClub(l: ClubLayout, ms: Meeting[]) {
  const hw = l.width / 2, hd = l.depth / 2
  // Every poster hangs in exactly one slot, with its meeting's number and its video.
  const all = ms.flatMap((m) => m.posters)
  expect(l.posters.map((s) => s.poster.id).sort((a, b) => a - b)).toEqual(all.map((p) => p.id).sort((a, b) => a - b))
  const number = new Map(ms.map((m) => [m.id, m.number]))
  for (const s of l.posters) {
    expect(s.meetingNumber).toBe(number.get(s.poster.meetingId))
    expect(s.videoUrl).toBe(s.poster.videoUrl)
    expect([s.width, s.height, s.y]).toEqual([0.9, 0.8, 1.95])
  }
  // On the wall, facing into the room.
  for (const s of l.posters.filter((p) => p.wall === 'left')) expect([s.x, s.normalX, s.normalZ]).toEqual([-hw, 1, 0])
  for (const s of l.posters.filter((p) => p.wall === 'right')) expect([s.x, s.normalX, s.normalZ]).toEqual([hw, -1, 0])
  for (const s of l.posters.filter((p) => p.wall === 'back')) expect([s.z, s.normalX, s.normalZ]).toEqual([-hd, 0, 1])
  // No two slots on one wall overlap, gap included.
  for (const wall of ['left', 'right', 'back'] as const) {
    const at = l.posters.filter((s) => s.wall === wall).map(alongWall).sort((a, b) => a - b)
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(0.9 + 0.25 - EPS)
  }
  // Side slots lie along the wall, over the bins, clear of the door and of the counter.
  const doorFrom = l.spawn.z - 0.8
  for (const s of l.posters.filter((p) => p.wall !== 'back')) {
    const lo = s.z - s.width / 2, hi = s.z + s.width / 2
    expect(lo).toBeGreaterThanOrEqual(-hd)
    expect(hi).toBeLessThanOrEqual(doorFrom + EPS)
    if (s.wall === 'right') expect(hi).toBeLessThanOrEqual(l.counter.minZ - 0.5 + EPS)
    const side = s.wall === 'left' ? -1 : 1
    expect(l.bins.some((b) => Math.sign(b.minX + b.maxX) === side && b.minZ <= lo + EPS && b.maxZ >= hi - EPS)).toBe(true)
  }
  // Back slots sit beside the sign, inside the wall.
  for (const s of l.posters.filter((p) => p.wall === 'back')) {
    expect(Math.abs(s.x - l.sign.x)).toBeGreaterThanOrEqual(l.sign.w / 2 + s.width / 2 + 0.25 - EPS)
    expect(Math.abs(s.x) + s.width / 2).toBeLessThanOrEqual(hw)
  }
  // The listening corner: the couch is solid and faces the back wall, with the table and the
  // rug between it and the wall; the sign hangs above the couch's back.
  expect(l.boxes).toContain(l.couch)
  expect(l.boxes).toContain(l.coffeeTable)
  expect(l.boxes).not.toContain(l.rug)
  for (const b of [l.coffeeTable, l.rug]) {
    expect(b.minZ).toBeGreaterThanOrEqual(-hd)
    expect(b.maxZ).toBeLessThanOrEqual(l.couch.minZ)
    expect(b.minX < l.couch.maxX && b.maxX > l.couch.minX).toBe(true)
  }
  expect(l.sign.y - l.sign.h / 2).toBeGreaterThan(COUCH.h)
  expect(l.sign.y + l.sign.h / 2).toBeLessThan(2.8)
  // Bins are solid and stay out of the corner.
  for (const b of l.bins) {
    expect(l.boxes).toContain(b)
    expect(b.minZ).toBeGreaterThanOrEqual(l.couch.maxZ)
  }
  expect(reachesCouch(l)).toBe(true)
}

describe('buildClubLayout: the listening corner and the posters', () => {
  it('lays out the fixture', () => {
    const l = buildClubLayout(archive.meetings)
    expectClub(l, archive.meetings)
    expectSound(l, allAlbums)
    expect(l.posters).toHaveLength(18)
    // Meeting 22 has no posters, so the back wall is just the sign.
    expect(l.posters.filter((s) => s.wall === 'back')).toEqual([])
    expect(l.sign).toEqual({ x: 0, y: expect.any(Number), w: 2.4, h: 1 })
  })

  it('hangs the others in meeting order: the left wall front to back, then the right wall back to front', () => {
    const ms = withPosters(18)
    const l = buildClubLayout(ms)
    const expected = ms.flatMap((m) => [...m.posters].sort((a, b) => a.position - b.position).map((p) => p.id))
    const left = l.posters.filter((s) => s.wall === 'left').sort((a, b) => b.z - a.z)
    const right = l.posters.filter((s) => s.wall === 'right').sort((a, b) => a.z - b.z)
    expect([...left, ...right].map((s) => s.poster.id)).toEqual(expected)
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
  })

  it('hangs the current meeting\'s posters beside the sign, alternating, and overflows to the left wall', () => {
    const five = buildClubLayout(withPosters(4, 5))
    const back = five.posters.filter((s) => s.wall === 'back')
    expect(back.map((s) => s.poster.meetingId)).toEqual([20, 20, 20, 20, 20])
    // In position order: left of the sign, right, left, right..., each further out.
    expect(back.map((s) => Math.sign(s.x))).toEqual([-1, 1, -1, 1, -1])
    expect(back.map((s) => Math.abs(s.x))).toEqual([...back.map((s) => Math.abs(s.x))].sort((a, b) => a - b))
    expect(five.posters.filter((s) => s.wall !== 'back').every((s) => s.meetingNumber !== 20)).toBe(true)

    const many = withPosters(4, 30)
    const l = buildClubLayout(many)
    expectClub(l, many)
    const onBack = l.posters.filter((s) => s.wall === 'back')
    expect(onBack.length).toBeGreaterThan(0)
    expect(onBack.length).toBeLessThan(30)
    // The rest of meeting 20's start the left wall run by the door, ahead of the older ones.
    const left = l.posters.filter((s) => s.wall === 'left').sort((a, b) => b.z - a.z)
    const right = l.posters.filter((s) => s.wall === 'right').sort((a, b) => a.z - b.z)
    expect([...left, ...right].map((s) => s.poster.id)).toEqual([
      ...many[19].posters.slice(onBack.length), ...many.slice(0, 19).flatMap((m) => m.posters),
    ].map((p) => p.id))
  })

  it('handles 0, 1, 18 and 300 posters, with and without current ones', () => {
    for (const n of [0, 1, 18, 300]) {
      for (const current of [0, 5]) {
        const ms = withPosters(n, current)
        const l = buildClubLayout(ms)
        expectClub(l, ms)
        expectSound(l, ms.flatMap((m) => m.albums))
      }
    }
    expectClub(buildClubLayout(meetings([0])), meetings([0]))
  })

  it('carries a poster\'s video', () => {
    const ms = withPosters(2)
    ms[0].posters[0] = { ...ms[0].posters[0], videoUrl: '/v/1.mp4' }
    const l = buildClubLayout(ms)
    expect(l.posters.find((s) => s.poster.id === ms[0].posters[0].id)!.videoUrl).toBe('/v/1.mp4')
  })

  it('grows deeper as posters arrive, and never shrinks', () => {
    const base = buildClubLayout(withPosters(0))
    let last = base.depth
    for (let n = 1; n <= 300; n++) {
      const d = buildClubLayout(withPosters(n, n % 3)).depth
      expect(d).toBeGreaterThanOrEqual(last)
      last = d
    }
    expect(last).toBeGreaterThan(base.depth)
    expect(buildClubLayout(withPosters(300)).width).toBe(base.width)
  })
})
