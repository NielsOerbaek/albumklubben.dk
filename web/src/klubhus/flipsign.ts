import * as THREE from 'three'
import { pixelate } from '../ps1/textures.ts'
import type { Meeting } from '../../../shared/types.ts'

/** The flaps on every cell of the board, in the order they turn. */
export const FLAPS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789.,:-&/!?\''
export const BOARD = { cols: 26, rows: 6 }
const RATE = 18 // flaps per second
const STAGGER = 0.04 // seconds between one column starting and the next

/** The flaps a cell turns through from `from` to `to`, wrapping round: `from` excluded, `to` included. */
export function flapPath(from: string, to: string): string[] {
  const path: string[] = []
  for (let i = Math.max(FLAPS.indexOf(from), 0); FLAPS[i] !== to && path.length < FLAPS.length;) {
    i = (i + 1) % FLAPS.length
    path.push(FLAPS[i])
  }
  return path
}

/** Upper case, accents folded to their base letter, æøå kept, quotes as ', anything else a blank flap. */
export function fold(text: string): string {
  return [...text.toUpperCase()].map((ch) => {
    if (FLAPS.includes(ch)) return ch
    if ('’‘“”«»"`´'.includes(ch)) return "'" // every quote mark is the board's one apostrophe
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '')
    return [...base].every((c) => FLAPS.includes(c)) ? base : ' '
  }).join('')
}

/** The board's text for a meeting: "MØDE n  D/M", the theme, then "ARTIST: TITLE" per album. */
export function boardLines(m: Meeting, cols: number, rows: number): string[] {
  const date = m.date?.match(/^\d{4}-(\d\d)-(\d\d)/)
  const lines = [`MØDE ${m.number}${date ? `  ${+date[2]}/${+date[1]}` : ''}`]
  if (m.theme) lines.push(m.theme)
  for (const a of m.albums) lines.push(`${a.artist}: ${a.title}`)
  return Array.from({ length: rows }, (_, i) => fold(lines[i] ?? '').slice(0, cols).padEnd(cols, ' '))
}

/** What the screen says about a lyttefest: playing now, or coming up within the day. */
export interface SignFest {
  artist: string
  title: string
  startsAt: string
  state: 'kommende' | 'nu' | 'slut' | 'aflyst'
  track: string | null
  trackNumber: number | null
}

/** "LYTTEFEST NU" with the album and the track; before it, the time it starts. */
export function festLines(f: SignFest, cols: number, rows: number): string[] {
  const at = new Date(f.startsAt)
  const two = (n: number) => String(n).padStart(2, '0')
  const when = Number.isNaN(at.getTime()) ? '' : `${at.getDate()}/${at.getMonth() + 1} ${two(at.getHours())}.${two(at.getMinutes())}`
  const lines = f.state === 'nu'
    ? ['LYTTEFEST NU', `${f.artist}: ${f.title}`,
      f.track ? `${f.trackNumber}. ${f.track}` : '']
    : ['LYTTEFEST', when, `${f.artist}: ${f.title}`]
  return Array.from({ length: rows }, (_, i) => fold(lines[i] ?? '').slice(0, cols).padEnd(cols, ' '))
}

/** Each glyph's flaps from blank, worked out once. */
const fromBlank = new Map<string, string[]>()

/** What the board shows `t` seconds after it was triggered from blank. */
export function boardAt(lines: string[], t: number): string[] {
  return lines.map((line) => [...line].map((to, col) => {
    let path = fromBlank.get(to)
    if (!path) fromBlank.set(to, path = flapPath(' ', to))
    const steps = Math.min(path.length, Math.max(0, Math.floor((t - col * STAGGER) * RATE)))
    return steps ? path[steps - 1] : ' '
  }).join(''))
}

// ---------------------------------------------------------------------------------------------
// The board's own type: 5×7 pixel glyphs. On the board they stretch to 5×9 by doubling the second
// and sixth rows (their vertical strokes), so the letters fill the flap; Å has a 9-row form of its own.

const FONT: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  Æ: '.####|#.#..|#.#..|#####|#.#..|#.#..|#.###',
  Ø: '.###.|#..##|#.#.#|#.#.#|#.#.#|##..#|.###.',
  Å: '..#..|.#.#.|..#..|.###.|#...#|#####|#...#',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|..##.|.#...|#....|#####',
  3: '####.|....#|....#|.###.|....#|....#|####.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  5: '#####|#....|#....|####.|....#|#...#|.###.',
  6: '.###.|#....|#....|####.|#...#|#...#|.###.',
  7: '#####|....#|...#.|..#..|..#..|..#..|..#..',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  9: '.###.|#...#|#...#|.####|....#|....#|.###.',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|..#..|.#...',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '-': '.....|.....|.....|.###.|.....|.....|.....',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  "'": '..#..|..#..|.#...|.....|.....|.....|.....',
}
const SMALL = new Map(Object.entries(FONT).map(([ch, rows]) => [ch, rows.split('|')]))
const TALL = new Map([...SMALL].map(([ch, r]) => [ch, [0, 1, 1, 2, 3, 4, 5, 5, 6].map((i) => r[i])]))
TALL.set('Å', '..#..|.#.#.|..#..|.###.|#...#|#...#|#####|#...#|#...#'.split('|'))

/** Draws `text` in the board's type at (x, y), one texel per dot, 6 texels a character: 5×9 when
 *  `tall`, else 5×7. Characters without a glyph are left blank. */
export function drawPixelText(g: CanvasRenderingContext2D, text: string, x: number, y: number, tall = false) {
  const font = tall ? TALL : SMALL
  for (const [i, ch] of [...text].entries()) font.get(ch)?.forEach((bits, r) => {
    for (let c = 0; c < 5; c++) if (bits[c] === '#') g.fillRect(x + i * 6 + c, y + r, 1, 1)
  })
}

// A cell is 8×14 texels: a 7×13 flap in two halves split by a black line, with a 1-texel black gap
// to the next. The board is framed by one more texel of black all round.
const CELL = { w: 8, h: 14 }
const INK = '#f1e9d2'

export interface FlipBoard {
  texture: THREE.CanvasTexture
  /** Blanks the board and flips it through to the text again. */
  trigger(): void
  /** New text, flipped to from whatever is up now. Nothing happens if it is the same. */
  setLines(lines: string[]): void
  update(dt: number): void
}

export function createFlipBoard(initial: string[]): FlipBoard {
  let lines = initial
  const cols = Math.max(0, ...lines.map((l) => l.length)), rows = lines.length
  const canvas = document.createElement('canvas')
  canvas.width = cols * CELL.w + 1
  canvas.height = rows * CELL.h + 1
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, canvas.width, canvas.height)
  const texture = pixelate(new THREE.CanvasTexture(canvas))

  function paintCell(col: number, row: number, ch: string) {
    const x = 1 + col * CELL.w, y = 1 + row * CELL.h
    const half = (CELL.h - 1) >> 1 // 6 texels above the split, 6 below
    g.fillStyle = '#34322f'; g.fillRect(x, y, CELL.w - 1, half)
    g.fillStyle = '#292826'; g.fillRect(x, y + half + 1, CELL.w - 1, half)
    g.fillStyle = '#000'; g.fillRect(x, y + half, CELL.w - 1, 1)
    g.fillStyle = INK
    drawPixelText(g, ch, x + 1, y + 2, true)
  }

  let shown = lines.map((l) => ' '.repeat(l.length))
  shown.forEach((l, row) => [...l].forEach((ch, col) => paintCell(col, row, ch)))
  let t = Infinity // not running until triggered

  return {
    texture,
    trigger() { t = 0 },
    setLines(next) {
      const fitted = Array.from({ length: rows }, (_, i) => (next[i] ?? '').slice(0, cols).padEnd(cols, ' '))
      if (fitted.every((l, i) => l === lines[i])) return
      lines = fitted
      t = 0 // flips from blank, as it does when you come near it
      shown = lines.map((l) => ' '.repeat(l.length))
      shown.forEach((l, row) => [...l].forEach((ch, col) => paintCell(col, row, ch)))
      texture.needsUpdate = true
    },
    update(dt) {
      if (t === Infinity) return
      t += dt
      const next = boardAt(lines, t)
      let changed = false
      next.forEach((line, row) => [...line].forEach((ch, col) => {
        if (shown[row][col] === ch) return
        paintCell(col, row, ch)
        changed = true
      }))
      shown = next
      if (changed) texture.needsUpdate = true
      if (next.every((l, i) => l === lines[i])) t = Infinity // settled
    },
  }
}
