import { formatMeetingDate } from '../../../shared/dates.ts'
import type { Album, Meeting, Poster } from '../../../shared/types.ts'
import { drawPixelText, fold } from './flipsign.ts'

export interface Spread { meeting: Meeting; posters: Poster[]; continued: boolean }
export interface Cell { x: number; y: number; w: number; h: number }
/** Page height / width. Pages are 1 wide in page units. */
export const PAGE_ASPECT = 1.4

const MARGIN = 0.07
const GAP = 0.04

/** One spread per four posters, newest meeting first; meetings without posters are left out. */
export function bookSpreads(meetings: Meeting[]): Spread[] {
  return [...meetings].reverse().flatMap((meeting) => {
    const sorted = [...meeting.posters].sort((a, b) => a.position - b.position)
    const out: Spread[] = []
    for (let i = 0; i < sorted.length; i += 4) out.push({ meeting, posters: sorted.slice(i, i + 4), continued: i > 0 })
    return out
  })
}

/** Places posters (aspect = h/w) on the right page in the largest equal-slot grid that fits:
 *  one row, one column, or anything between, rows of fewer posters centred. */
export function posterCells(aspects: number[]): Cell[] {
  const n = aspects.length
  const aw = 1 - 2 * MARGIN, ah = PAGE_ASPECT - 2 * MARGIN
  let best: { cells: Cell[]; score: number } | null = null
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const sw = (aw - GAP * (cols - 1)) / cols, sh = (ah - GAP * (rows - 1)) / rows
    const cells = aspects.map((a, i): Cell => {
      const w = Math.min(sw, sh / a), h = w * a
      const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols)
      const x = MARGIN + ((cols - inRow) * (sw + GAP)) / 2 + (i % cols) * (sw + GAP) + (sw - w) / 2
      return { x, y: MARGIN + row * (sh + GAP) + (sh - h) / 2, w, h }
    })
    const score = Math.min(...cells.map((c) => c.w * c.h))
    if (!best || score > best.score) best = { cells, score }
  }
  return best?.cells ?? []
}

/** Paints a spread's left page: "MØDE n", date/time, theme and "FORTSAT" as pixel text, and returns
 *  where the album covers go (canvas pixels, square); the caller draws the covers. */
export function drawLeftPage(g: CanvasRenderingContext2D, s: Spread, size: { w: number; h: number }): { albums: (Cell & { album: Album })[] } {
  const { w, h } = size
  const k = Math.max(1, Math.floor(w / 100)) // two texels a dot on a 200 px page, so it reads from above
  const m = Math.round(w * MARGIN)
  const perLine = Math.max(1, Math.floor((w - 2 * m) / (6 * k)))
  const { meeting } = s
  g.fillStyle = '#efe8d6'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#2a2622'
  g.save()
  g.scale(k, k)
  let y = m / k
  const line = (text: string, tall = false) => {
    const rows: string[] = []
    // A word longer than a line is cut into line-long pieces rather than running off the page.
    const words = fold(text).split(' ').filter(Boolean).flatMap((w) => w.match(new RegExp(`.{1,${perLine}}`, 'gu')) ?? [])
    for (const word of words) {
      const last = rows.length - 1
      if (last >= 0 && rows[last].length + 1 + word.length <= perLine) rows[last] += ' ' + word
      else rows.push(word)
    }
    for (const r of rows) { drawPixelText(g, r, m / k, y, tall); y += tall ? 12 : 10 }
    y += 4
  }
  line(`Møde ${meeting.number}`, true)
  const date = formatMeetingDate(meeting.date, meeting.time)
  if (date) line(date)
  if (meeting.theme) line(meeting.theme)
  if (s.continued) line('Fortsat')
  g.restore()

  const albums = meeting.albums
  const top = Math.round(y * k), aw = w - 2 * m, ah = h - m - top
  const gap = Math.round(w * 0.03)
  let side = 0, cols = 1
  for (let c = 1; c <= albums.length; c++) {
    const rows = Math.ceil(albums.length / c)
    const sd = Math.min((aw - gap * (c - 1)) / c, (ah - gap * (rows - 1)) / rows, w * 0.4)
    if (sd > side) { side = sd; cols = c }
  }
  side = Math.max(0, Math.floor(side))
  return {
    albums: albums.map((album, i) => ({
      album, w: side, h: side,
      x: m + (i % cols) * (side + gap), y: top + Math.floor(i / cols) * (side + gap),
    })),
  }
}
