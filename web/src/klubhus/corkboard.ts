import * as THREE from 'three'
import { at } from '../ps1/build.ts'
import { rng, speckle } from '../ps1/paint.ts'
import { pixelate } from '../ps1/textures.ts'
import { drawPixelText, fold } from './flipsign.ts'
import { kit } from './room.ts'
import type { ClubLayout } from './layout.ts'
import { firstName, type BoardPost } from '../../../shared/board.ts'
import { textureUrl } from '../api.ts'

/**
 * Opslagstavlen on the bare wall by the door: a cork board with the group's latest posts pinned
 * to it, drawn into one canvas at the room's own low resolution, like the flip board.
 *
 * The board is filled in after the room has loaded, so a slow Theta never holds the room up, and
 * when it cannot be fetched it says so on a note rather than staying empty.
 */
const { decal, shadedBox } = kit

// Six notes, three across and two down. The texture is the board's own grid: 6 texels a character.
const COLS = 3
const ROWS = 2
const CELL = { w: 86, h: 82 }
const TEX = { w: COLS * CELL.w, h: ROWS * CELL.h }
const PAD = 6 // the note's margin inside its cell
const MARGIN = 4 // the text's margin inside the note
const LINE = 9 // a line of 5×7 type, with air under it
const GLYPH = 6 // the board's type is 6 texels to a character
/** The characters that fit across a note, so nothing is drawn off the paper. */
const COLS_TEXT = Math.floor((CELL.w - PAD * 2 - MARGIN * 2) / GLYPH)

const CORK = '#b07c3c'
const FRAME = '#6b4a28'
const INK = '#2b2520'
/** Paper, in the shades a club's notes come in. A lyttefest is on its own colour, with the cover. */
const PAPERS = ['#efe7d2', '#f2dcc6', '#dfe6e8', '#f0dfe4', '#e5e8d6', '#eadfee']
const FEST_PAPER = '#fe3ebe'
const COVER = 34 // texels: the cover on a lyttefest note
const PIN = ['#b9120a', '#1d4e89', '#2f6b35', '#8a5a1b']

const BOARD_H = 1.25 // metres
const BOARD_Y = 1.45 // the middle of the board above the floor
const DEPTH = 0.06
/** How close you must stand, and how squarely you must look, for a click to open it. */
export const BOARD_REACH = 2.2

export interface CorkBoard {
  object: THREE.Object3D
  /** The board's own picture, as the flip board has one: handy for a dev page. */
  texture: THREE.CanvasTexture
  /** The middle of the board on the floor plan, to measure how close you are. */
  centre: { x: number; z: number }
  /** Draws the posts on the board. `'error'` puts up the one note that says so. */
  setPosts(posts: BoardPost[] | 'error'): void
}

/** The words that fit a note: whole words where they can be, cut where a word is too long. */
export function wrap(text: string, cols: number, max: number): string[] {
  const out: string[] = []
  for (const word of fold(text).split(/\s+/).filter(Boolean)) {
    if (out.length === 0) out.push(word.slice(0, cols))
    else if (out.at(-1)!.length + 1 + word.length <= cols) out[out.length - 1] += ` ${word}`
    else out.push(word.slice(0, cols))
    if (out.length === max) break
  }
  // A cut-off note ends in three dots, so a cut is never read as the end of a sentence.
  if (out.length === max && fold(text).length > out.join(' ').length) {
    out[max - 1] = `${out[max - 1].slice(0, cols - 3).trimEnd()}...`
  }
  return out
}

/** Album covers for the notes, each fetched once and kept. */
const covers = new Map<string, HTMLImageElement>()
function cover(url: string, ready: (img: HTMLImageElement) => void) {
  const src = textureUrl(url, 64)
  const had = covers.get(src)
  if (had?.complete) return ready(had)
  if (had) return had.addEventListener('load', () => ready(had), { once: true })
  const img = new Image()
  covers.set(src, img)
  img.addEventListener('load', () => ready(img), { once: true })
  img.src = src
}

export function createCorkBoard(layout: ClubLayout): CorkBoard {
  const canvas = document.createElement('canvas')
  canvas.width = TEX.w
  canvas.height = TEX.h
  const g = canvas.getContext('2d')!
  const texture = pixelate(new THREE.CanvasTexture(canvas))

  function paint(posts: BoardPost[] | 'error') {
    g.fillStyle = CORK
    g.fillRect(0, 0, TEX.w, TEX.h)
    speckle(g, TEX.w, TEX.h, 0.09, 7)

    const notes = posts === 'error'
      ? [{ name: '', lines: wrap('Tavlen kan ikke hentes lige nu', COLS_TEXT, 4), foot: '', cover: null }]
      : posts.length === 0
        ? [{ name: '', lines: wrap('Der er ikke skrevet noget endnu', COLS_TEXT, 4), foot: '', cover: null }]
        : posts.slice(0, COLS * ROWS).map((p) => p.lyttefest
          ? {
            name: 'LYTTEFEST',
            lines: wrap(`${p.lyttefest.artist}: ${p.lyttefest.title}`, COLS_TEXT, 2),
            foot: p.commentCount > 0 ? `${p.commentCount} SVAR` : '',
            cover: p.lyttefest.coverUrl,
          }
          : {
            name: fold(firstName(p.author.name)).slice(0, COLS_TEXT),
            lines: wrap(p.title || p.body, COLS_TEXT, 3),
            foot: p.commentCount > 0 ? `${p.commentCount} SVAR` : '',
            cover: null as string | null,
          })

    const r = rng(11)
    notes.forEach((note, i) => {
      const cx = (i % COLS) * CELL.w
      const cy = Math.floor(i / COLS) * CELL.h
      const x = cx + PAD, y = cy + PAD
      const w = CELL.w - PAD * 2, h = CELL.h - PAD * 2
      // The paper, with a hard shadow under it so it stands off the cork.
      g.fillStyle = 'rgb(0 0 0 / 0.25)'
      g.fillRect(x + 2, y + 2, w, h)
      const isFest = note.name === 'LYTTEFEST'
      g.fillStyle = isFest ? FEST_PAPER : PAPERS[i % PAPERS.length]
      g.fillRect(x, y, w, h)
      g.fillStyle = INK
      let line = y + 6
      if (note.name) {
        drawPixelText(g, note.name, x + MARGIN, line)
        line += LINE + 2
        g.fillRect(x + MARGIN, line - 4, w - MARGIN * 2, 1)
      }
      for (const text of note.lines) {
        drawPixelText(g, text, x + MARGIN, line)
        line += LINE
      }
      if (note.cover) {
        // The cover is drawn when it arrives; the note is already up by then.
        const at = { x: x + (w - COVER) / 2 | 0, y: y + h - COVER - 12 }
        g.fillStyle = '#00000022'
        g.fillRect(at.x, at.y, COVER, COVER)
        cover(note.cover, (img) => {
          g.drawImage(img, at.x, at.y, COVER, COVER)
          texture.needsUpdate = true
        })
      }
      if (note.foot) {
        g.fillStyle = isFest ? '#5a1142' : '#6a625a'
        drawPixelText(g, note.foot, x + MARGIN, y + h - 11)
      }
      // The pin.
      const pin = PIN[Math.floor(r() * PIN.length)]
      g.fillStyle = pin
      g.fillRect(x + (w >> 1) - 1, y - 2, 3, 4)
      g.fillStyle = '#000'
      g.fillRect(x + (w >> 1) - 1, y + 2, 3, 1)
    })
    texture.needsUpdate = true
  }

  paint([])

  // On the +X wall, facing into the room: a plane turned a quarter turn, in a wooden frame.
  const { from, to } = layout.freeWall
  const span = Math.abs(to - from)
  const width = Math.min(2.2, Math.max(1.2, span - 0.8))
  const z = (from + to) / 2
  const x = layout.width / 2
  const object = new THREE.Group()

  const frame = shadedBox(DEPTH, BOARD_H + 0.1, width + 0.1, FRAME)
  object.add(at(frame, x - DEPTH / 2, BOARD_Y, z))

  // A decal, so the frame four millimetres behind it cannot poke through: the vertices of both
  // are snapped to the PS1 grid, and at this size that is more than four millimetres of wobble.
  // It showed as dark shapes wandering across the notes.
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, BOARD_H, 6, 4), decal('#ffffff', texture))
  object.add(at(face, x - DEPTH - 0.004, BOARD_Y, z, -Math.PI / 2))

  return {
    object,
    texture,
    centre: { x, z },
    setPosts: paint,
  }
}
