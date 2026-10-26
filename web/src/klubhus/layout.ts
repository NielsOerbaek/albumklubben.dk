import { GENRE_ORDER, genreFamily } from '../../../shared/genre.ts'
import { latestMeetingWithAlbums } from '../../../shared/latest.ts'
import type { Album, Meeting } from '../../../shared/types.ts'
import type { Box2 } from '../ps1/collide.ts'

/** A crate of records. Its front (where you stand to flip) faces +Z turned by `rotationY`. */
export interface CrateSpec { id: string; label: string; albums: Album[]; x: number; z: number; rotationY: number }

export interface ShopLayout {
  width: number
  depth: number
  crates: CrateSpec[]
  boxes: Box2[]
  spawn: { x: number; z: number; yaw: number }
  counter: Box2
  /** Table tops, three crates each. */
  tables: Box2[]
  /** Record shelves along the side walls. */
  shelves: Box2[]
}

// The room spans x in [-width/2, width/2] and z in [-depth/2, depth/2]. The back wall
// (posters, sign) is at -Z, the door and the counter are at the front (+Z).
const PER_CRATE = 12
export const TABLE = { w: 2.2, d: 0.8, h: 0.78 }
export const COUNTER = { w: 3, d: 0.6, h: 1 }
export const SHELF_DEPTH = 0.35
const CRATE_PITCH = 0.7 // crate centres along a table
const AISLE = 2.4 // table rows, centre to centre
const SIDE = 1.5 // side wall to the nearest table end
const COL_GAP = 1.3 // walkway between table ends
const BACK = 1.6 // back wall to the first row's centre
const FRONT = 3.6 // last row's centre to the front wall: aisle, counter, room behind it
const MIN_W = 10
const MIN_D = 8

function genreCrates(meetings: Meeting[]): Omit<CrateSpec, 'x' | 'z' | 'rotationY'>[] {
  const number = new Map(meetings.map((m) => [m.id, m.number]))
  const albums = meetings.flatMap((m) => m.albums).sort((a, b) =>
    number.get(b.meetingId)! - number.get(a.meetingId)! || a.position - b.position)
  return GENRE_ORDER.flatMap((family) => {
    const mine = albums.filter((a) => genreFamily(a.genre) === family)
    return Array.from({ length: Math.ceil(mine.length / PER_CRATE) }, (_, i) => ({
      id: `${family}-${i + 1}`,
      label: i ? `${family} ${i + 1}` : family,
      albums: mine.slice(i * PER_CRATE, (i + 1) * PER_CRATE),
    }))
  })
}

const box = (cx: number, cz: number, w: number, d: number): Box2 =>
  ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 })

export function buildShopLayout(meetings: Meeting[]): ShopLayout {
  const genre = genreCrates(meetings)
  const tableCount = Math.ceil(genre.length / 3)
  const cols = tableCount < 2 ? 1 : Math.max(2, Math.ceil(Math.sqrt(tableCount)))
  const rows = Math.ceil(tableCount / cols)

  const width = Math.max(MIN_W, 2 * SIDE + cols * TABLE.w + (cols - 1) * COL_GAP)
  const depth = Math.max(MIN_D, BACK + Math.max(rows - 1, 0) * AISLE + FRONT)
  const hw = width / 2, hd = depth / 2

  // Tables fill rows from the back, left to right, centred across the room. Crates face the front.
  const blockW = cols * TABLE.w + (cols - 1) * COL_GAP
  const tables: Box2[] = []
  const crates: CrateSpec[] = []
  for (let t = 0; t < tableCount; t++) {
    const tx = -blockW / 2 + TABLE.w / 2 + (t % cols) * (TABLE.w + COL_GAP)
    const tz = -hd + BACK + Math.floor(t / cols) * AISLE
    tables.push(box(tx, tz, TABLE.w, TABLE.d))
    genre.slice(t * 3, t * 3 + 3).forEach((c, i) =>
      crates.push({ ...c, x: tx + (i - 1) * CRATE_PITCH, z: tz, rotationY: 0 }))
  }

  // The counter runs from the right wall; the shopkeeper stands between it and the front wall.
  const counter = box(hw - COUNTER.w / 2, hd - 1.3, COUNTER.w, COUNTER.d)
  const latest = latestMeetingWithAlbums(meetings)
  if (latest) {
    crates.unshift({ id: 'nyt', label: 'Nyt', albums: latest.albums.slice(0, PER_CRATE),
      x: counter.minX + 0.6, z: hd - 1.3, rotationY: Math.PI })
  }

  // Shelves along both side walls, stopping short of the front so the door and counter stay clear.
  const shelfLen = depth - 2.6
  const shelves = [-1, 1].map((s) => box(s * (hw - SHELF_DEPTH / 2), -hd + shelfLen / 2, SHELF_DEPTH, shelfLen))

  const walls = [
    { minX: -hw - 1, maxX: hw + 1, minZ: -hd - 1, maxZ: -hd },
    { minX: -hw - 1, maxX: hw + 1, minZ: hd, maxZ: hd + 1 },
    { minX: -hw - 1, maxX: -hw, minZ: -hd, maxZ: hd },
    { minX: hw, maxX: hw + 1, minZ: -hd, maxZ: hd },
  ]

  return {
    width, depth, crates, tables, shelves, counter,
    boxes: [...walls, ...tables, ...shelves, counter],
    // Just inside the door, turned a little towards the aisles and the counter.
    spawn: { x: -hw + SIDE + 0.4, z: hd - 0.9, yaw: -0.35 },
  }
}
