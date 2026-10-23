import type { Album, Meeting, Poster } from '../../../shared/types.ts'
import type { Box2 } from '../ps1/collide.ts'

/** A framed poster or cover. (x, y, z) is the centre of the picture on the wall's surface, and
 *  (normalX, normalZ) points from the wall into the room. */
export interface WallItem { kind: 'poster' | 'cover'; meetingNumber: number; poster?: Poster; album?: Album
  x: number; y: number; z: number; normalX: number; normalZ: number; width: number; height: number }
export interface Plaque { meetingNumber: number; lines: string[]; x: number; y: number; z: number; normalX: number; normalZ: number }
export interface Hall { title: string; meetingNumbers: number[]; bounds: Box2 }
export interface MuseumLayout { halls: Hall[]; items: WallItem[]; plaques: Plaque[]; boxes: Box2[]
  spawn: { x: number; z: number; yaw: number }
  /** Benches down the middle of the halls (also in `boxes`). */
  benches: Box2[] }

// The halls run in a line along +X, all HALL_W wide (z in [-HALL_W/2, HALL_W/2]), joined by
// doorways on the centre line through WALL_T thick walls. Sections alternate between the left
// wall (-Z, facing +Z) and the right wall (+Z, facing -Z) in meeting order as you walk in.
export const HALL_W = 9
export const CEILING = 6
export const WALL_T = 0.3
export const DOOR = { w: 2.4, h: 3.6 }
export const POSTER_H = 1.4
export const COVER = 0.5
export const PLAQUE = { w: 0.32, h: 0.2 }
export const BENCH = { w: 1.8, d: 0.5 }
const FALLBACK_ASPECT = 0.79 / 1.4 // the club's posters are 9:16 phone stories
const EYE = 1.6 // poster and cover centres
const PLAQUE_Y = 1.35
const GAP = 0.3 // between the pieces of a section
const COVER_GAP = 0.12 // between the two covers of a column
const SECTION_GAP = 1.2
const END = 2 // end wall to the nearest piece; also keeps a playing video out of the next hall
const MIN_L = 8
const ENTRANCE_L = 10
const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september',
  'oktober', 'november', 'december']

/** '2026-08-18' as 'd. 18. august 2026', or null if it is not a date. */
function formatDate(date: string | null): string | null {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m || +m[2] < 1 || +m[2] > 12) return null
  return `d. ${+m[3]}. ${MONTHS[+m[2] - 1]} ${m[1]}`
}

const themeOf = (m: Meeting) => m.theme?.trim() || null

/** Runs of one theme are a hall each; meetings without a theme go four to a hall. */
function groupHalls(meetings: Meeting[]): { title: string; meetings: Meeting[] }[] {
  const groups: { theme: string | null; meetings: Meeting[] }[] = []
  for (const m of [...meetings].sort((a, b) => a.number - b.number)) {
    if (!m.posters.length && !m.albums.length) continue
    const last = groups.at(-1)
    const theme = themeOf(m)
    if (last && last.theme === theme && (theme || last.meetings.length < 4)) last.meetings.push(m)
    else groups.push({ theme, meetings: [m] })
  }
  return groups.map(({ theme, meetings: ms }) => {
    const a = ms[0].number, b = ms.at(-1)!.number
    return { title: theme ?? (a === b ? `Møde ${a}` : `Møde ${a}-${b}`), meetings: ms }
  })
}

/** One piece of a section, `u` metres along the wall from the section's reading start. */
type Piece = { u: number; y: number; w: number; h: number; poster?: Poster; album?: Album; plaque?: true }

/** A meeting's section, read left to right: its plaque, its posters, then its covers in
 *  columns of two. Returns the pieces and the section's length along the wall. */
function section(m: Meeting, aspects: Map<number, number>): { pieces: Piece[]; length: number } {
  const pieces: Piece[] = []
  let u = 0
  const put = (w: number, piece: Omit<Piece, 'u' | 'w'>) => {
    if (u) u += GAP
    pieces.push({ ...piece, u: u + w / 2, w })
    u += w
  }
  put(PLAQUE.w, { y: PLAQUE_Y, h: PLAQUE.h, plaque: true })
  for (const poster of m.posters) put(POSTER_H * (aspects.get(poster.id) ?? FALLBACK_ASPECT), { y: EYE, h: POSTER_H, poster })
  for (let i = 0; i < m.albums.length; i += 2) {
    const column = m.albums.slice(i, i + 2)
    column.forEach((album, j) => {
      const y = EYE + (column.length === 2 ? (j ? -1 : 1) * (COVER + COVER_GAP) / 2 : 0)
      if (j) pieces.push({ ...pieces.at(-1)!, y, album })
      else put(COVER, { y, h: COVER, album })
    })
  }
  return { pieces, length: u }
}

function plaqueLines(m: Meeting): string[] {
  return [`Møde ${m.number}`, formatDate(m.date), themeOf(m)].filter((l): l is string => !!l)
}

/** The museum laid out from the archive. `aspects` maps a poster id to its image's width/height. */
export function buildMuseumLayout(meetings: Meeting[], aspects = new Map<number, number>()): MuseumLayout {
  const hw = HALL_W / 2
  const halls: Hall[] = []
  const items: WallItem[] = []
  const plaques: Plaque[] = []
  const benches: Box2[] = []
  let x0 = 0

  const addHall = (title: string, ms: Meeting[], minLength: number) => {
    const sections = ms.map((m) => ({ m, ...section(m, aspects) }))
    const walls = [0, 1].map((side) => sections.filter((_, i) => i % 2 === side))
    const wallLength = (ss: typeof sections) =>
      ss.reduce((sum, s) => sum + s.length, 0) + SECTION_GAP * Math.max(ss.length - 1, 0)
    const length = Math.max(minLength, 2 * END + Math.max(...walls.map(wallLength)))

    walls.forEach((ss, side) => {
      // Left wall: faces +Z and reads along +X. Right wall: faces -Z and reads along -X.
      const normalZ = side ? -1 : 1
      const z = -normalZ * hw
      let start = x0 + (length - wallLength(ss)) / 2
      for (const s of ss) {
        for (const p of s.pieces) {
          const x = side ? start + s.length - p.u : start + p.u
          const at = { meetingNumber: s.m.number, x, y: p.y, z, normalX: 0, normalZ }
          if (p.plaque) plaques.push({ ...at, lines: plaqueLines(s.m) })
          else items.push({ ...at, kind: p.poster ? 'poster' : 'cover', poster: p.poster, album: p.album,
            width: p.w, height: p.h })
        }
        start += s.length + SECTION_GAP
      }
    })

    halls.push({ title, meetingNumbers: ms.map((m) => m.number), bounds: { minX: x0, maxX: x0 + length, minZ: -hw, maxZ: hw } })
    if (ms.length) {
      const cx = x0 + length / 2
      benches.push({ minX: cx - BENCH.w / 2, maxX: cx + BENCH.w / 2, minZ: -BENCH.d / 2, maxZ: BENCH.d / 2 })
    }
    x0 += length + WALL_T
  }

  addHall('Albumklubben Museum', [], ENTRANCE_L)
  for (const g of groupHalls(meetings)) addHall(g.title, g.meetings, MIN_L)

  const start = halls[0].bounds.minX, end = halls.at(-1)!.bounds.maxX
  const boxes: Box2[] = [
    { minX: start - 1, maxX: end + 1, minZ: -hw - 1, maxZ: -hw },
    { minX: start - 1, maxX: end + 1, minZ: hw, maxZ: hw + 1 },
    { minX: start - 1, maxX: start, minZ: -hw, maxZ: hw },
    { minX: end, maxX: end + 1, minZ: -hw, maxZ: hw },
  ]
  // The wall between two halls, either side of its doorway.
  for (const h of halls.slice(0, -1)) {
    const a = h.bounds.maxX, b = a + WALL_T
    boxes.push({ minX: a, maxX: b, minZ: -hw, maxZ: -DOOR.w / 2 }, { minX: a, maxX: b, minZ: DOOR.w / 2, maxZ: hw })
  }

  return {
    halls, items, plaques, benches,
    boxes: [...boxes, ...benches],
    // Inside the front door, looking down the entrance hall to the first doorway.
    spawn: { x: start + 1.5, z: 0, yaw: -Math.PI / 2 },
  }
}
