import { speckle } from '../ps1/paint.ts'
import { drawPixelText, fold } from './flipsign.ts'
import { wrap } from './corkboard.ts'
import { firstName, formatPostTime, type BoardPost } from '../../../shared/board.ts'
import type { Board, BoardState } from '../board/board.ts'
import './boardmenu.css'

/**
 * Opslagstavlen, close up: the cork board you were just looking at, filling the screen as a menu.
 *
 * It is drawn the way the room is drawn — one small canvas, the board's own 5×7 type, hard pixels
 * blown up — so stepping up to the board is going further into the same game rather than out of
 * it into a web page. Arrows or the mouse move down the notes, Enter opens the one you are on,
 * Esc comes back out.
 *
 * Nothing is read here that the board on the wall does not already have: a note is a way in to
 * the post on Theta, which is where it is answered.
 */
const CORK = '#b07c3c'
const FRAME = '#6b4a28'
const INK = '#2b2520'
const PAPER = '#efe7d2'
/** A note not under the cursor sits in the board's shade; the one under it is in the light. */
const PAPER_DIM = '#cbbd9d'
const INK_DIM = '#5f574c'
const PLANK_INK = '#e8d9bc'
const FEST = '#fe3ebe'
const FEST_DIM = '#cc8fb8' // light enough that the board's ink still reads on it

/** Texels. The height is fixed, like a console's line count; the width follows the screen. */
const H = 240
const MIN_W = 320
const MAX_W = 560
const GLYPH = 6 // the board's type is 6 texels to a character
const PAD = 8
const HEAD_H = 18
const FOOT_H = 14
const ROW_H = 16
const DETAIL_H = 58

export type MenuItem =
  | { kind: 'post'; post: BoardPost; label: string; note: string }
  | { kind: 'more' | 'write' | 'close'; label: string; note: string }

/**
 * The menu's rows: the posts, then the way to older ones, the way in to writing, and the way out.
 * The last three are rows like any other, so the whole thing can be used with a mouse alone by
 * someone who never learns that Esc closes it.
 */
export function menuItems(state: BoardState): MenuItem[] {
  const items: MenuItem[] = state.posts.map(post => ({
    kind: 'post' as const,
    label: post.lyttefest
      ? `${firstName(post.author.name)}: LYTTEFEST`
      : `${firstName(post.author.name)}: ${post.title || post.body || '...'}`,
    note: post.lyttefest ? `${post.lyttefest.artist}: ${post.lyttefest.title}` : post.body || post.title || '',
    post,
  }))
  if (state.cursor) items.push({ kind: 'more', label: 'HENT FLERE OPSLAG', note: 'Der hænger flere længere nede på tavlen.' })
  if (state.groupUrl) items.push({ kind: 'write', label: 'SKRIV I GRUPPEN', note: 'Opslag skrives og besvares på Theta. Her hænger de bare.' })
  items.push({ kind: 'close', label: 'TILBAGE TIL RUMMET', note: 'Esc gør det samme.' })
  return items
}

/**
 * The row you land on moving `by` from `selected`, in a menu of `count`. It stops at either end
 * rather than coming round, the way the records in a crate do: pressing on past the last row
 * should leave you on the last row, not back at the top with no sign that you have been round.
 */
export function nextRow(selected: number, by: number, count: number): number {
  return Math.min(count - 1, Math.max(0, selected + by))
}

/** The first row to draw, so the one you are on is always on screen. */
export function windowStart(selected: number, count: number, rows: number, was = 0): number {
  if (count <= rows) return 0
  const top = Math.min(Math.max(was, 0), count - rows)
  if (selected < top) return selected
  if (selected >= top + rows) return selected - rows + 1
  return top
}

/** How many characters of the board's type fit across `texels`. */
const colsIn = (texels: number) => Math.max(1, Math.floor(texels / GLYPH))

/**
 * One line of the board's type: whole words where they fit, three dots where it had to be cut.
 *
 * `wrap` from the cork board cannot do this — asked for one line it stops after the first word —
 * and a row on a menu is one line by definition, so it has its own.
 */
export function fitLine(text: string, cols: number): string {
  const t = fold(text).trim().replace(/\s+/g, ' ')
  if (t.length <= cols) return t
  if (cols <= 3) return t.slice(0, cols)
  const cut = t.slice(0, cols - 3)
  const space = cut.lastIndexOf(' ')
  // A cut inside the first word leaves the letters; past it, the line ends on a whole word.
  return `${(space > cols / 2 ? cut.slice(0, space) : cut).trimEnd()}...`
}

export interface BoardMenu {
  isOpen(): boolean
  open(): void
  close(): void
  /** Draws again: the board has new posts, or the window changed size. */
  draw(): void
}

export interface BoardMenuOptions {
  board: Board
  /** Called when the menu closes, however it was closed, so the room takes the controls back. */
  onClose(): void
  /** Opens a post on Theta. Its own function so a test does not open a window. */
  openUrl?(url: string): void
}

export function createBoardMenu(opts: BoardMenuOptions): BoardMenu {
  const canvas = document.createElement('canvas')
  canvas.className = 'board-menu'
  canvas.hidden = true
  document.body.append(canvas)
  const g = canvas.getContext('2d')!
  const openUrl = opts.openUrl ?? ((url: string) => window.open(url, '_blank', 'noreferrer'))

  let open = false
  let selected = 0
  let top = 0
  let width = MIN_W
  /** Where each row was drawn, so the mouse can be pointed at one. */
  let hitRows: { from: number; to: number; index: number }[] = []

  function size() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight)
    width = Math.round(Math.min(MAX_W, Math.max(MIN_W, H * aspect)))
    canvas.width = width
    canvas.height = H
  }

  // --- The painting ------------------------------------------------------------------------

  const plank = (y: number, h: number) => {
    g.fillStyle = FRAME
    g.fillRect(0, y, width, h)
    g.fillStyle = 'rgb(0 0 0 / 0.22)'
    g.fillRect(0, y + h - 1, width, 1)
  }

  function rowTemplate(item: MenuItem, y: number, on: boolean) {
    const w = width - PAD * 2
    const fest = item.kind === 'post' && item.post.lyttefest !== null
    g.fillStyle = 'rgb(0 0 0 / 0.25)'
    g.fillRect(PAD + 2, y + 2, w, ROW_H - 3)
    g.fillStyle = fest ? (on ? FEST : FEST_DIM) : on ? PAPER : PAPER_DIM
    g.fillRect(PAD, y, w, ROW_H - 3)
    // The cursor is a pin pushed into the note you are on, not an arrow beside it.
    if (on) {
      g.fillStyle = '#b9120a'
      g.fillRect(PAD + 3, y + 4, 3, 4)
      g.fillStyle = '#000'
      g.fillRect(PAD + 3, y + 8, 3, 1)
    }
    const x = PAD + 10
    const right = item.kind === 'post' && item.post.commentCount > 0
      ? `${item.post.commentCount} SVAR`
      : item.kind === 'post' ? fold(formatPostTime(item.post.createdAt)) : ''
    const rightW = right.length * GLYPH
    const room = colsIn(width - PAD * 2 - 10 - (rightW ? rightW + 12 : 6))
    g.fillStyle = on ? INK : INK_DIM
    drawPixelText(g, fitLine(item.label, room), x, y + 3)
    if (right) drawPixelText(g, right, width - PAD - 4 - rightW, y + 3)
  }

  function detail(item: MenuItem | undefined, y: number) {
    g.fillStyle = 'rgb(0 0 0 / 0.25)'
    g.fillRect(PAD + 2, y + 2, width - PAD * 2, DETAIL_H)
    g.fillStyle = PAPER
    g.fillRect(PAD, y, width - PAD * 2, DETAIL_H)
    if (!item) return
    const cols = colsIn(width - PAD * 2 - 12)
    g.fillStyle = INK
    let line = y + 6
    if (item.kind === 'post') {
      drawPixelText(g, fold(item.post.author.name).slice(0, cols), PAD + 6, line)
      line += 11
      g.fillStyle = INK_DIM
      g.fillRect(PAD + 6, line - 4, width - PAD * 2 - 12, 1)
      g.fillStyle = INK
    }
    for (const text of wrap(item.note, cols, item.kind === 'post' ? 3 : 4)) {
      drawPixelText(g, text, PAD + 6, line)
      line += 9
    }
    if (item.kind === 'post' && item.post.url) {
      g.fillStyle = INK_DIM
      drawPixelText(g, 'ENTER: ÅBN PÅ THETA', PAD + 6, y + DETAIL_H - 11)
    }
  }

  function paint() {
    const state = opts.board.state()
    const items = menuItems(state)
    selected = Math.min(selected, Math.max(0, items.length - 1))

    g.fillStyle = CORK
    g.fillRect(0, 0, width, H)
    speckle(g, width, H, 0.09, 7)

    plank(0, HEAD_H)
    g.fillStyle = PLANK_INK
    drawPixelText(g, 'OPSLAGSTAVLEN', PAD, 5, true)

    const listY = HEAD_H + 8
    const listH = H - FOOT_H - DETAIL_H - 8 - listY
    const rows = Math.max(1, Math.floor(listH / ROW_H))
    top = windowStart(selected, items.length, rows, top)

    hitRows = []
    if (state.error) {
      g.fillStyle = PAPER
      g.fillRect(PAD, listY, width - PAD * 2, ROW_H * 2)
      g.fillStyle = INK
      const cols = colsIn(width - PAD * 2 - 12)
      wrap(state.error.message, cols, 2).forEach((t, i) => drawPixelText(g, t, PAD + 6, listY + 5 + i * 9))
    } else if (state.busy && items.length <= 1) {
      g.fillStyle = PLANK_INK
      drawPixelText(g, 'HENTER ...', PAD, listY + 4)
    } else {
      items.slice(top, top + rows).forEach((item, i) => {
        const y = listY + i * ROW_H
        const index = top + i
        rowTemplate(item, y, index === selected)
        hitRows.push({ from: y, to: y + ROW_H, index })
      })
      // Which way there is more, when the whole board does not fit on the screen at once.
      g.fillStyle = PLANK_INK
      if (top > 0) drawPixelText(g, '...', width - PAD - 18, listY - 7)
      if (top + rows < items.length) drawPixelText(g, '...', width - PAD - 18, listY + rows * ROW_H - 2)
    }

    detail(items[selected], H - FOOT_H - DETAIL_H - 4)

    plank(H - FOOT_H, FOOT_H)
    g.fillStyle = PLANK_INK
    drawPixelText(g, 'PILE: VÆLG   ENTER: ÅBN   ESC: TILBAGE', PAD, H - FOOT_H + 4)
  }

  const draw = () => { if (open) paint() }

  // --- Doing things ------------------------------------------------------------------------

  function choose(index: number) {
    const items = menuItems(opts.board.state())
    const item = items[index]
    if (!item) return
    if (item.kind === 'close') return close()
    if (item.kind === 'more') return void opts.board.more()
    if (item.kind === 'write') {
      const url = opts.board.state().groupUrl
      return void (url && openUrl(url))
    }
    if (item.kind === 'post' && item.post.url) openUrl(item.post.url)
  }

  const move = (by: number) => {
    const count = menuItems(opts.board.state()).length
    if (count === 0) return
    const next = nextRow(selected, by, count)
    if (next === selected) return
    selected = next
    draw()
  }

  /** Where the pointer is on the small canvas, whatever size the canvas is shown at. */
  function rowAt(e: MouseEvent): number | null {
    const box = canvas.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return null
    const y = ((e.clientY - box.top) / box.height) * H
    return hitRows.find(r => y >= r.from && y < r.to)?.index ?? null
  }

  const onKey = (e: KeyboardEvent) => {
    if (!open) return
    const by = e.code === 'ArrowDown' || e.code === 'KeyS' ? 1
      : e.code === 'ArrowUp' || e.code === 'KeyW' ? -1 : 0
    if (by !== 0) { e.preventDefault(); return move(by) }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); choose(selected) }
    else if (e.code === 'Escape') close()
  }
  const onMove = (e: MouseEvent) => {
    const row = rowAt(e)
    if (row !== null && row !== selected) { selected = row; draw() }
  }
  const onClick = (e: MouseEvent) => {
    const row = rowAt(e)
    if (row !== null) { selected = row; choose(row) }
  }
  const onWheel = (e: WheelEvent) => { e.preventDefault(); move(e.deltaY > 0 ? 1 : -1) }
  const onResize = () => { if (open) { size(); paint() } }

  function close() {
    if (!open) return
    open = false
    canvas.hidden = true
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onResize)
    opts.onClose()
  }

  canvas.addEventListener('mousemove', onMove)
  canvas.addEventListener('click', onClick)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return {
    isOpen: () => open,
    open() {
      if (open) return
      open = true
      selected = 0
      top = 0
      canvas.hidden = false
      size()
      paint()
      document.addEventListener('keydown', onKey)
      window.addEventListener('resize', onResize)
      // Always a fresh read; the server holds each member's own for half a minute anyway.
      void opts.board.load()
    },
    close,
    draw,
  }
}
