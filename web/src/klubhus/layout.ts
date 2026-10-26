import { GENRE_ORDER, genreFamily } from '../../../shared/genre.ts'
import { latestMeetingWithAlbums } from '../../../shared/latest.ts'
import type { Album, Meeting, Poster } from '../../../shared/types.ts'
import type { Box2 } from '../ps1/collide.ts'

/** A crate of records. Its front (where you stand to flip) faces +Z turned by `rotationY`. */
export interface CrateSpec { id: string; label: string; albums: Album[]; x: number; z: number; rotationY: number }

/** A poster's place on a wall. `x`/`z` is its centre on the wall's surface and `normalX`/`normalZ`
 *  points into the room, so it fits `Placed` in ps1/video.ts. */
export interface PosterSlot {
  poster: Poster
  meetingNumber: number
  x: number
  y: number
  z: number
  normalX: number
  normalZ: number
  width: number
  height: number
  videoUrl: string | null
  wall: 'left' | 'right' | 'back'
}

/** A meeting's plaque, centred under the run of its posters it labels. `x`/`z` is on the wall's
 *  surface, `y` the plaque's top edge, `width` the run's length along the wall. The scene sizes
 *  the plaque itself from its texture. */
export interface Plaque {
  meetingNumber: number
  x: number
  y: number
  z: number
  normalX: number
  normalZ: number
  width: number
  wall: PosterSlot['wall']
}

export interface ClubLayout {
  width: number
  depth: number
  crates: CrateSpec[]
  boxes: Box2[]
  spawn: { x: number; z: number; yaw: number }
  counter: Box2
  /** Table tops, three crates each. */
  tables: Box2[]
  /** Waist-high record bins along the side walls, under the posters. */
  bins: Box2[]
  /** The listening corner at the back: the couch faces the back wall (-Z) over the table and rug. */
  couch: Box2
  rug: Box2
  coffeeTable: Box2
  /** The flip sign on the back wall, centred at (x, y). */
  sign: { x: number; y: number; w: number; h: number }
  /** The meeting the flip sign shows: the latest with albums. */
  latest: Meeting | null
  posters: PosterSlot[]
  /** One per run of a meeting's posters: a meeting's posters hang together, so usually one per
   *  meeting, but the current meeting gets one each side of the sign. */
  plaques: Plaque[]
}

// The room spans x in [-width/2, width/2] and z in [-depth/2, depth/2]. The back wall
// (sign, current posters, the listening corner) is at -Z, the door and the counter are at the front (+Z).
const PER_CRATE = 12
export const TABLE = { w: 2.2, d: 0.8, h: 0.78 }
export const COUNTER = { w: 3, d: 0.6, h: 1 }
export const BIN = { h: 1.2, d: 0.45 }
export const SLOT = { w: 0.9, h: 0.8, gap: 0.25 }
export const POSTER_Y = 1.95
export const COUCH = { w: 2.2, d: 0.9, h: 0.85 }
export const COFFEE_TABLE = { w: 1, d: 0.5, h: 0.4 }
export const SIGN = { w: 2.4, h: 1 }
const LOUNGE = 3.2 // the listening corner's depth, added at the back
const CRATE_PITCH = 0.7 // crate centres along a table
const AISLE = 2.4 // table rows, centre to centre
const SIDE = 1.5 // side wall to the nearest table end
const COL_GAP = 1.3 // walkway between table ends
const BACK = 1.6 // the lounge (or the poster run's extra wall) to the first row's centre
const FRONT = 3.6 // last row's centre to the front wall: aisle, counter, room behind it
const MIN_W = 10
const MIN_D = 8
const SPAWN_IN = 0.9 // the spawn's distance from the front wall
const COUNTER_IN = 1.3 // the counter's centre from the front wall
const DOOR_CLEAR = 0.8 // no side poster within this of the spawn, along the wall
const COUNTER_CLEAR = 0.5
const PITCH = SLOT.w + SLOT.gap
const GROUP_GAP = 0.6 // extra wall between two meetings' posters
const SEP = SLOT.gap + GROUP_GAP
const PLAQUE_DROP = 0.055 // a full-height poster's frame bottom to its plaque's top
const DEPTH_STEP = 0.05 // the room's depth grows in these steps, on a fixed grid
// Wall the side runs lose to the lounge and the front: the left run stops short of the door, the
// right one short of the counter. A run spans the bins, from the lounge to its front end.
const LEFT_LOST = LOUNGE + SPAWN_IN + DOOR_CLEAR
const RIGHT_LOST = LOUNGE + COUNTER_IN + COUNTER.d / 2 + COUNTER_CLEAR

/** Slots that fit along `len` metres of wall. */
const fits = (len: number) => Math.max(0, Math.floor((len + SLOT.gap) / PITCH + 1e-9))
/** Wall `k` slots need. */
const runFor = (k: number) => (k ? k * PITCH - SLOT.gap : 0)

/** Hangs the meetings' groups of posters on walls of the given lengths, in order: a group that
 *  does not fit the rest of a wall moves on to the next one, so it hangs together. Only a group
 *  too long for the whole wall it starts splits, filling that wall and going on on the next; on
 *  the last wall there is no next, so the room grows instead. Returns each wall's runs in order,
 *  or null when the walls are too short. */
function pack(groups: Poster[][], walls: number[]): Poster[][][] | null {
  const out: Poster[][][] = walls.map(() => [])
  let w = 0, used = 0 // wall `w` is taken up to `used` metres, its last run's end
  for (let rest of groups) {
    while (rest.length) {
      if (w === walls.length) return null
      const need = (used ? used + SEP : 0) + runFor(rest.length)
      if (need <= walls[w] + 1e-6) { out[w].push(rest); used = need; break }
      if (!used) { // too long for a whole wall
        const k = fits(walls[w])
        if (k) out[w].push(rest.slice(0, k))
        rest = rest.slice(k)
      }
      w++
      used = 0
    }
  }
  return out
}

/** The least depth, on a fixed grid, whose side walls hold `groups`. Fitting only gets easier as
 *  the walls lengthen, and harder as posters arrive, so the room never shrinks when one does. */
function posterDepth(groups: Poster[][]): number {
  if (!groups.length) return 0
  // A start below the answer: every run end to end on the two walls, less one gap where they change.
  const total = groups.reduce((sum, g) => sum + runFor(g.length), 0) + (groups.length - 1) * SEP
  let k = Math.max(0, Math.floor((total - SEP + LEFT_LOST + RIGHT_LOST) / 2 / DEPTH_STEP))
  while (!pack(groups, [k * DEPTH_STEP - LEFT_LOST, k * DEPTH_STEP - RIGHT_LOST])) k++
  return k * DEPTH_STEP
}

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

export function buildClubLayout(meetings: Meeting[]): ClubLayout {
  const genre = genreCrates(meetings)
  const tableCount = Math.ceil(genre.length / 3)
  const cols = tableCount < 2 ? 1 : Math.max(2, Math.ceil(Math.sqrt(tableCount)))
  const rows = Math.ceil(tableCount / cols)

  const width = Math.max(MIN_W, 2 * SIDE + cols * TABLE.w + (cols - 1) * COL_GAP)
  const hw = width / 2

  // The current meeting's posters hang either side of the sign, as many as the back wall holds;
  // the rest start the left wall's run, ahead of every other poster in meeting order.
  const latest = latestMeetingWithAlbums(meetings)
  const byPosition = (m: Meeting) => [...m.posters].sort((a, b) => a.position - b.position)
  const number = new Map(meetings.map((m) => [m.id, m.number]))
  const current = latest ? byPosition(latest) : []
  const perSide = fits(hw - SIGN.w / 2 - SLOT.gap - SLOT.gap) // off the sign, off the corner
  const back = current.slice(0, 2 * perSide)
  // The side walls hang the posters in groups, a meeting's together.
  const groups = [current.slice(back.length),
    ...[...meetings].sort((a, b) => a.number - b.number).filter((m) => m !== latest).map(byPosition)]
    .filter((g) => g.length)

  // Depth: the tables' own, plus the lounge, or more when the side walls need it for the posters.
  // The extra goes between the lounge and the tables, so the tables keep their place by the door.
  const tableDepth = Math.max(MIN_D, BACK + Math.max(rows - 1, 0) * AISLE + FRONT)
  const depth = Math.max(tableDepth + LOUNGE, posterDepth(groups))
  const hd = depth / 2

  // Tables fill rows from the back, left to right, centred across the room. Crates face the front.
  const blockW = cols * TABLE.w + (cols - 1) * COL_GAP
  const tables: Box2[] = []
  const crates: CrateSpec[] = []
  for (let t = 0; t < tableCount; t++) {
    const tx = -blockW / 2 + TABLE.w / 2 + (t % cols) * (TABLE.w + COL_GAP)
    const tz = hd - tableDepth + BACK + Math.floor(t / cols) * AISLE
    tables.push(box(tx, tz, TABLE.w, TABLE.d))
    genre.slice(t * 3, t * 3 + 3).forEach((c, i) =>
      crates.push({ ...c, x: tx + (i - 1) * CRATE_PITCH, z: tz, rotationY: 0 }))
  }

  // The counter runs from the right wall; the shopkeeper stands between it and the front wall.
  const counter = box(hw - COUNTER.w / 2, hd - COUNTER_IN, COUNTER.w, COUNTER.d)
  if (latest) {
    crates.unshift({ id: 'nyt', label: 'Nyt', albums: latest.albums.slice(0, PER_CRATE),
      x: counter.minX + 0.6, z: hd - COUNTER_IN, rotationY: Math.PI })
  }

  // The listening corner: the couch faces the back wall, the coffee table (1.15 m off the wall)
  // and the rug between them.
  const tableZ = -hd + 1.15 + COFFEE_TABLE.d / 2
  const coffeeTable = box(0, tableZ, COFFEE_TABLE.w, COFFEE_TABLE.d)
  const couch = box(0, coffeeTable.maxZ + 0.5 + COUCH.d / 2, COUCH.w, COUCH.d)
  const rug = { minX: -1.3, maxX: 1.3, minZ: -hd + 0.6, maxZ: couch.minZ }
  const sign = { x: 0, y: POSTER_Y, ...SIGN }

  // The side runs, over the bins: from the lounge to the door on the left, to the counter on the right.
  const runBack = -hd + LOUNGE
  const leftFront = hd - SPAWN_IN - DOOR_CLEAR
  const rightFront = counter.minZ - COUNTER_CLEAR
  const bins = [box(-hw + BIN.d / 2, (runBack + leftFront) / 2, BIN.d, leftFront - runBack),
    box(hw - BIN.d / 2, (runBack + rightFront) / 2, BIN.d, rightFront - runBack)]
  const [leftRuns, rightRuns] = pack(groups, [leftFront - runBack, rightFront - runBack])!

  const slot = (poster: Poster, wall: PosterSlot['wall'], x: number, z: number, normalX: number, normalZ: number): PosterSlot =>
    ({ poster, meetingNumber: number.get(poster.meetingId)!, x, y: POSTER_Y, z, normalX, normalZ,
      width: SLOT.w, height: SLOT.h, videoUrl: poster.videoUrl, wall })
  const plaque = (run: Poster[], wall: PosterSlot['wall'], x: number, z: number, normalX: number, normalZ: number): Plaque =>
    ({ meetingNumber: number.get(run[0].meetingId)!, x, y: POSTER_Y - SLOT.h / 2 - PLAQUE_DROP, z, normalX, normalZ,
      width: runFor(run.length), wall })
  const posters: PosterSlot[] = []
  const plaques: Plaque[] = []

  // The current meeting's, beside the sign in position order: left, right, left..., each further
  // out, with a plaque under each side's.
  const out = SIGN.w / 2 + SLOT.gap + SLOT.w / 2
  back.forEach((p, i) => posters.push(slot(p, 'back', (i % 2 ? 1 : -1) * (out + Math.floor(i / 2) * PITCH), -hd, 0, 1)))
  for (const s of [-1, 1]) {
    const run = back.filter((_, i) => (i % 2 ? 1 : -1) === s)
    if (run.length) plaques.push(plaque(run, 'back', s * (out - SLOT.w / 2 + runFor(run.length) / 2), -hd, 0, 1))
  }

  // The side runs: the left wall from the door towards the back, the right from the back towards
  // the counter, a gap between meetings.
  const hang = (runs: Poster[][], wall: 'left' | 'right', start: number, dir: number) => {
    const x = wall === 'left' ? -hw : hw, normalX = wall === 'left' ? 1 : -1
    let z = start
    runs.forEach((run, r) => {
      if (r) z += dir * SEP
      run.forEach((p, i) => posters.push(slot(p, wall, x, z + dir * (SLOT.w / 2 + i * PITCH), normalX, 0)))
      plaques.push(plaque(run, wall, x, z + dir * runFor(run.length) / 2, normalX, 0))
      z += dir * runFor(run.length)
    })
  }
  hang(leftRuns, 'left', leftFront, -1)
  hang(rightRuns, 'right', runBack, 1)

  const walls = [
    { minX: -hw - 1, maxX: hw + 1, minZ: -hd - 1, maxZ: -hd },
    { minX: -hw - 1, maxX: hw + 1, minZ: hd, maxZ: hd + 1 },
    { minX: -hw - 1, maxX: -hw, minZ: -hd, maxZ: hd },
    { minX: hw, maxX: hw + 1, minZ: -hd, maxZ: hd },
  ]

  return {
    width, depth, crates, tables, bins, counter, couch, rug, coffeeTable, sign, posters, plaques, latest: latest ?? null,
    boxes: [...walls, ...tables, ...bins, counter, couch, coffeeTable],
    // Just inside the door, turned a little towards the aisles and the counter.
    spawn: { x: -hw + SIDE + 0.4, z: hd - SPAWN_IN, yaw: -0.35 },
  }
}
