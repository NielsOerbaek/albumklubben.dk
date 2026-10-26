import { GENRE_ORDER, genreFamily } from '../../../shared/genre.ts'
import { latestMeetingWithAlbums } from '../../../shared/latest.ts'
import type { Album, Meeting } from '../../../shared/types.ts'
import type { Box2 } from '../ps1/collide.ts'

/** A crate of records on the table. Its front (where you stand to flip) faces +Z turned by
 *  `rotationY`; the library sets `Math.PI / 2`, so the front faces +X, the room side. */
export interface CrateSpec { id: string; label: string; albums: Album[]; x: number; z: number; rotationY: number }

export interface ClubLayout {
  /** The room spans x in [-width/2, width/2] and z in [-length/2, length/2]. The windows are the
   *  -X wall, the shelves the +X wall, the door is in the +Z wall and the screen and stairs are at -Z. */
  width: number
  length: number
  ceiling: number
  /** Square concrete columns (COLUMN_SIZE), flush with the long walls, at a steady pitch. */
  columns: { x: number; z: number }[]
  /** Along the -X wall, in front of the columns: chipboard top, cushions against the glass. */
  windowBench: Box2
  /** The terrazzo table, parallel to the bench; the crates and the book stand on it. */
  table: Box2
  /** Nyt first (nearest the door, +Z), then the genre crates in GENRE_ORDER toward -Z. Fronts face +X. */
  crates: CrateSpec[]
  /** The poster book, lying shut on the table at its -Z end. `w` is along X, `d` along Z. */
  book: { x: number; z: number; w: number; d: number }
  /** Shelf bays on the +X wall between the columns: z ranges. None where the free wall is. */
  shelves: { z0: number; z1: number }[]
  /** The modular sofa's blocks, a row along the +X side facing -X (the table). */
  sofa: Box2[]
  /** Two lounge chairs facing +X, toward the coffee table and sofa. */
  chairs: Box2[]
  coffeeTable: Box2
  /** The screen on its stand in front of the stairs, facing +Z (down the room). x/z is the centre. */
  screen: { x: number; z: number; w: number; h: number }
  /** The stairs at the far end, +X corner, behind the glass; solid. */
  stairs: Box2
  /** Floor photo rectangles in the strip between table and sofas (centres), newest covers first. */
  floorCollage: { x: number; z: number; w: number; d: number; imageUrl: string }[]
  /** Bare wall near the door for the bulletin board: z range along the given wall. */
  freeWall: { wall: '+X' | '-Z' | '+Z'; from: number; to: number }
  /** The meeting the screen shows: the latest with albums. */
  latest: Meeting | null
  /** The walls (the first four, just outside the room) and everything solid. */
  boxes: Box2[]
  /** Just inside the door, looking down the room (-Z, yaw 0). */
  spawn: { x: number; z: number; yaw: number }
}

const PER_CRATE = 12
export const COLUMN_SIZE = 0.45
export const TABLE = { w: 1, h: 0.75 }
export const BENCH = { d: 0.5, h: 0.45 }
/** The shelf planks' depth off the +X wall; the bays are solid that deep. */
export const SHELF_D = 0.4
const CEILING = 3.4
const WIDTH = 9
const MIN_LENGTH = 18 // a near-empty club still reads as the long room (2x its width)
const COLUMN_PITCH = 3
const WALL_T = 0.3
const CRATE_PITCH = 0.7 // crate centres along the table
const CRATE_END = 0.4 // the table's door end to the first crate's edge
const BOOK = { w: 0.7, d: 0.5 }
const BOOK_END = 0.3 // the table's far end to the book
const BOOK_ZONE = BOOK_END + BOOK.d + 0.15 // far end to the nearest crate edge
const DOOR_END = 3.2 // the door wall to the table's near end
const FAR_END = 3 // the table's far end to the far wall
const STRIP_X = { from: -1.6, to: 0.8 } // the floor collage's strip, between table and chairs
const COLLAGE_DEPTHS = [1.6, 1.2, 0.8, 1.4]

export function genreCrates(meetings: Meeting[]): Omit<CrateSpec, 'x' | 'z' | 'rotationY'>[] {
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

export function buildClubLayout(meetings: Meeting[]): ClubLayout {
  const genre = genreCrates(meetings)
  const latest = latestMeetingWithAlbums(meetings) ?? null
  const crateCount = genre.length + (latest ? 1 : 0)

  // The crates need a table length; the room follows it, and the table then spans the room
  // from DOOR_END to FAR_END off the far wall (crates pack from the door end, the book sits at the far end).
  const needed = CRATE_END + crateCount * CRATE_PITCH + BOOK_ZONE
  const length = Math.max(MIN_LENGTH, DOOR_END + needed + FAR_END)
  const tableLen = length - DOOR_END - FAR_END
  const hw = WIDTH / 2
  const hl = length / 2

  const windowBench: Box2 = { minX: -hw + COLUMN_SIZE, maxX: -hw + COLUMN_SIZE + BENCH.d, minZ: -hl, maxZ: hl }
  const tableX0 = windowBench.maxX + 0.5 // the 0.5 m between bench and table is dead floor
  const table: Box2 = { minX: tableX0, maxX: tableX0 + TABLE.w, minZ: hl - DOOR_END - tableLen, maxZ: hl - DOOR_END }
  const tableX = tableX0 + TABLE.w / 2

  const specs = [...(latest ? [{ id: 'nyt', label: 'Nyt', albums: latest.albums.slice(0, PER_CRATE) }] : []), ...genre]
  const crates: CrateSpec[] = specs.map((c, i) => ({
    ...c, x: tableX, z: table.maxZ - CRATE_END - (i + 0.5) * CRATE_PITCH, rotationY: Math.PI / 2,
  }))
  const book = { x: tableX, z: table.minZ + BOOK_END + BOOK.d / 2, ...BOOK }

  // Columns along both long walls, centred on the room.
  const n = Math.floor(length / COLUMN_PITCH)
  const z0 = hl - (length - n * COLUMN_PITCH) / 2
  const colZ = Array.from({ length: n }, (_, i) => z0 - (i + 0.5) * COLUMN_PITCH)
  const columns = colZ.flatMap((z) => [-1, 1].map((s) => ({ x: s * (hw - COLUMN_SIZE / 2), z })))

  // The far end: stairs in the +X corner, the screen in front of them facing the door. The flight
  // climbs along X from the room's middle, a long and shallow run (about 35°) as in photo 7.
  const stairs: Box2 = { minX: -0.9, maxX: hw - COLUMN_SIZE, minZ: -hl, maxZ: -hl + 2.6 }
  const screen = { x: 2.5, z: -hl + 3.1, w: 1.6, h: 0.9 }
  const stand = box(screen.x, screen.z, screen.w + 0.1, 0.5)

  // The sofa zone, on the +X side, nearer the far end than the door.
  const zs = -hl + 4.4
  const sofa = Array.from({ length: 5 }, (_, i) => ({
    minX: hw - COLUMN_SIZE - 0.9, maxX: hw - COLUMN_SIZE, minZ: zs + i, maxZ: zs + i + 1 }))
  const chairs = [zs + 1, zs + 4].map((z) => box(1.4, z, 0.8, 0.8))
  const coffeeTable = box(2.3, zs + 2.5, 0.6, 1.2)

  // The free wall is the whole first bay from the door: the bare stretch between the two columns nearest it.
  const freeWall = { wall: '+X' as const, from: colZ[1] + COLUMN_SIZE / 2, to: colZ[0] - COLUMN_SIZE / 2 }
  const shelves = colZ.slice(0, -1).map((z, i) => ({ z0: colZ[i + 1] + COLUMN_SIZE / 2, z1: z - COLUMN_SIZE / 2 }))
    .filter((b) => b.z1 <= freeWall.from && b.z0 >= stairs.maxZ)

  // The floor photos: the club's covers (newest meeting first), then its posters, two to a row.
  const order = new Map(meetings.map((m) => [m.id, m.number]))
  const covers = meetings.flatMap((m) => m.albums).sort((a, b) =>
    order.get(b.meetingId)! - order.get(a.meetingId)! || a.position - b.position).map((a) => a.coverUrl)
  const posters = [...meetings].sort((a, b) => b.number - a.number).flatMap((m) =>
    [...m.posters].sort((a, b) => a.position - b.position).map((p) => p.imageUrl))
  const images = [...new Set([...covers, ...posters].filter((u): u is string => !!u))]
  const floorCollage: ClubLayout['floorCollage'] = []
  const colW = (STRIP_X.to - STRIP_X.from) / 2
  for (let row = 0, top = hl - 1; floorCollage.length < images.length; row++) {
    const d = COLLAGE_DEPTHS[row % COLLAGE_DEPTHS.length]
    if (top - d < -hl + 3) break
    for (let c = 0; c < 2 && floorCollage.length < images.length; c++) {
      floorCollage.push({ x: STRIP_X.from + (c + 0.5) * colW, z: top - d / 2, w: colW, d, imageUrl: images[floorCollage.length] })
    }
    top -= d
  }

  const walls: Box2[] = [
    { minX: -hw - WALL_T, maxX: -hw, minZ: -hl, maxZ: hl },
    { minX: hw, maxX: hw + WALL_T, minZ: -hl, maxZ: hl },
    { minX: -hw - WALL_T, maxX: hw + WALL_T, minZ: -hl - WALL_T, maxZ: -hl },
    { minX: -hw - WALL_T, maxX: hw + WALL_T, minZ: hl, maxZ: hl + WALL_T },
  ]
  return {
    width: WIDTH, length, ceiling: CEILING, columns, windowBench, table, crates, book, shelves, sofa, chairs,
    coffeeTable, screen, stairs, floorCollage, freeWall, latest,
    boxes: [...walls, ...columns.map((c) => box(c.x, c.z, COLUMN_SIZE, COLUMN_SIZE)), windowBench, table,
      ...sofa, ...chairs, coffeeTable, stand, stairs,
      ...shelves.map((s) => ({ minX: hw - SHELF_D, maxX: hw, minZ: s.z0, maxZ: s.z1 }))],
    spawn: { x: (STRIP_X.from + STRIP_X.to) / 2, z: hl - 1, yaw: 0 },
  }
}
