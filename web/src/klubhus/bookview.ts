import * as THREE from 'three'
import { textureUrl } from '../api.ts'
import { at, coverTexture } from '../ps1/build.ts'
import { ps1Material } from '../ps1/material.ts'
import { fitText, painted, rng, speckle } from '../ps1/paint.ts'
import { loadPixelTexture, pixelate } from '../ps1/textures.ts'
import type { Album, Meeting, Poster } from '../../../shared/types.ts'
import { drawPixelText } from './flipsign.ts'
import { drawLeftPage, PAGE_ASPECT, posterCells, type Cell, type Spread } from './book.ts'
import { TABLE, type ClubLayout } from './layout.ts'
import { FOG, kit } from './room.ts'

// The poster book on the table. Shut, a thick cloth-bound box with "PLAKATER" on the cover. Open,
// a spread lies flat: the meeting's page on the left (a canvas from `drawLeftPage`, its covers drawn
// in) and its posters on the right, each a plane at its own shape. A page turn is a subdivided sheet
// bent over the spine.
//
// The book is built in its own frame, as the reader sees it: x runs across the spread (spine at 0,
// the left page at -x), y is up, and a page's top is at -z. The reader stands on the room side of
// the table (+X), so the frame is turned a quarter: local +z is world +X, local +x is world -Z.

export interface BookView {
  object: THREE.Object3D
  open(): void
  close(): void
  isOpen(): boolean
  /** Turns a page forward (1) or back (-1) in about 0.4 s; false at either end. */
  turn(dir: 1 | -1): boolean
  spread(): number
  /** What the view's centre ray hits on the open spread, or null. */
  aim(ray: THREE.Raycaster): { kind: 'poster'; poster: Poster; meeting: Meeting } | { kind: 'album'; album: Album } | null
  /** Where the camera goes to read the open book. */
  viewPose(): { position: THREE.Vector3; yaw: number; pitch: number }
  update(dt: number): void
}

const { mat } = kit
const PAPER = '#efe8d6'
const CLOTH = '#7d2b24'
const PX = { w: 200, h: Math.round(200 * PAGE_ASPECT) } // a page's canvas: the room's resolution
const TURN_TIME = 0.4
const SEGS = 12 // the turning sheet's cuts across its width
const BEND = 1.3 // how far the sheet's free edge lags behind its spine as it turns
const BOARD = 0.012 // the covers' thickness

/** The cover: cloth, a frame, "PLAKATER" and the wordmark. Top of the canvas is the book's top. */
const coverTex = () => painted(100, 140, (g) => {
  g.fillStyle = CLOTH; g.fillRect(0, 0, 100, 140)
  speckle(g, 100, 140, 0.08, 7)
  g.fillStyle = '#e9dcc0'
  g.fillRect(8, 8, 84, 1); g.fillRect(8, 131, 84, 1); g.fillRect(8, 8, 1, 124); g.fillRect(91, 8, 1, 124)
  g.textAlign = 'center'; g.textBaseline = 'middle'
  fitText(g, 'PLAKATER', 74, 22, 700)
  g.fillText('PLAKATER', 50, 52)
  g.fillRect(30, 66, 40, 1)
  drawPixelText(g, 'ALBUMKLUBBEN', 14, 108) // the wordmark in the flip board's type, 72 texels wide
})

/** The pages' edges: cream, finely lined. */
const edgeTex = () => painted(16, 16, (g) => {
  g.fillStyle = '#e8e0cb'; g.fillRect(0, 0, 16, 16)
  const r = rng(5)
  for (let y = 0; y < 16; y += 2) { g.fillStyle = `rgb(0 0 0 / ${0.05 + r() * 0.08})`; g.fillRect(0, y, 16, 1) }
}, true)

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2)

/** One spread's pages, built when it is the current spread or next to it, and dropped after. */
interface Pages {
  left: THREE.CanvasTexture
  /** The right page as one picture, for the turning sheet; the posters on it arrive as they load. */
  right: THREE.CanvasTexture
  /** The posters as planes on the right page, at their own shapes; empty until they have loaded. */
  posters: THREE.Group
  albums: (Cell & { album: Album })[] // page units
  cells: (Cell & { poster: Poster })[] // page units
  dispose(): void
}

function canvasTexture() {
  const c = document.createElement('canvas')
  c.width = PX.w; c.height = PX.h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.fillStyle = PAPER; g.fillRect(0, 0, PX.w, PX.h)
  return { g, tex: pixelate(new THREE.CanvasTexture(c)) }
}

function buildPages(spread: Spread, pw: number, ph: number): Pages {
  let gone = false
  const owned: { dispose(): void }[] = []

  const L = canvasTexture()
  const albums = drawLeftPage(L.g, spread, PX).albums.map((a) => {
    L.g.fillStyle = a.album.cardColor
    L.g.fillRect(a.x, a.y, a.w, a.h)
    coverTexture(a.album)?.then((t) => {
      if (gone) return
      L.g.drawImage(t.image as CanvasImageSource, a.x, a.y, a.w, a.h)
      L.tex.needsUpdate = true
    }).catch(() => {}) // a missing cover keeps its colour
    return { album: a.album, x: a.x / PX.w, y: a.y / PX.w, w: a.w / PX.w, h: a.h / PX.w }
  })

  const R = canvasTexture()
  const posters = new THREE.Group()
  const cells: Pages['cells'] = []
  Promise.allSettled(spread.posters.map((p) => loadPixelTexture(textureUrl(p.imageUrl, 256)))).then((loaded) => {
    const texOf = loaded.map((r) => (r.status === 'fulfilled' ? r.value : null))
    if (gone) return texOf.forEach((t) => t?.dispose())
    const aspects = texOf.map((t) => {
      const img = t?.image as { width: number; height: number } | undefined
      return img?.width ? img.height / img.width : PAGE_ASPECT
    })
    posterCells(aspects).forEach((c, i) => {
      const tex = texOf[i]
      cells.push({ ...c, poster: spread.posters[i] })
      const geo = new THREE.PlaneGeometry(c.w * pw, c.h * pw, 2, 2).rotateX(-Math.PI / 2)
      const m = ps1Material({ map: tex, color: tex ? '#ffffff' : '#9c9a94', decal: true, ...FOG })
      owned.push(geo, m)
      if (tex) owned.push(tex)
      posters.add(at(new THREE.Mesh(geo, m), (c.x + c.w / 2) * pw, 0, -ph / 2 + (c.y + c.h / 2) * pw))
      const [x, y, w, h] = [c.x, c.y, c.w, c.h].map((v) => Math.round(v * PX.w))
      R.g.fillStyle = '#9c9a94'
      R.g.fillRect(x, y, w, h)
      if (tex) R.g.drawImage(tex.image as CanvasImageSource, x, y, w, h)
    })
    R.tex.needsUpdate = true
  }).catch((err) => console.error(err)) // the page stays paper rather than an unhandled rejection

  return {
    left: L.tex, right: R.tex, posters, albums, cells,
    dispose() {
      gone = true
      posters.removeFromParent()
      L.tex.dispose(); R.tex.dispose()
      owned.forEach((o) => o.dispose())
    },
  }
}

export async function createBookView(spreads: Spread[], where: ClubLayout['book']): Promise<BookView> {
  // A page is as wide as the shut book is deep and PAGE_ASPECT as tall, so its canvas, cells and aim agree.
  const pw = where.d, ph = pw * PAGE_ASPECT
  const n = spreads.length
  const thick = THREE.MathUtils.clamp(0.05 + n * 0.006, 0.08, 0.16)
  const object = at(new THREE.Group(), where.x, TABLE.h, where.z, Math.PI / 2)
  object.updateMatrixWorld(true)

  // Shut: the cloth box, the pages' edges showing on three sides, the spine on the left.
  const edge = edgeTex(), cover = coverTex()
  const cloth = (s: number) => mat(CLOTH, null, s)
  const shut = new THREE.Mesh(new THREE.BoxGeometry(pw, thick, ph, 1, 1, 2),
    [mat('#ffffff', edge, 0.72), cloth(0.6), mat('#ffffff', cover), cloth(0.4), mat('#ffffff', edge, 0.86), mat('#ffffff', edge, 0.8)])
  shut.position.y = thick / 2
  object.add(shut)

  // Open: the boards under the spread, a block of pages under each side, and the two pages on top.
  const spreadGroup = new THREE.Group()
  spreadGroup.visible = false
  object.add(spreadGroup)
  spreadGroup.add(at(new THREE.Mesh(new THREE.BoxGeometry(2 * pw + 0.03, BOARD, ph + 0.03, 2, 1, 2),
    [cloth(0.72), cloth(0.72), cloth(1), cloth(0.4), cloth(0.86), cloth(0.8)]), 0, BOARD / 2, 0))
  const blockGeo = new THREE.BoxGeometry(pw, 1, ph).translate(0, 0.5, 0)
  const blockMats = [mat('#ffffff', edge, 0.6), mat('#ffffff', edge, 0.6), mat(PAPER), mat(PAPER, null, 0.4), mat('#ffffff', edge, 0.7), mat('#ffffff', edge, 0.66)]
  const blocks = [-1, 1].map((s) => {
    const b = at(new THREE.Mesh(blockGeo, blockMats), s * pw / 2, BOARD, 0)
    spreadGroup.add(b)
    return b
  })
  const pageGeo = new THREE.PlaneGeometry(pw, ph, 4, 4).rotateX(-Math.PI / 2)
  const leftMat = ps1Material({ color: PAPER, ...FOG })
  const leftPage = at(new THREE.Mesh(pageGeo, leftMat), -pw / 2, 0, 0)
  const rightPage = at(new THREE.Mesh(pageGeo, mat(PAPER)), pw / 2, 0, 0)
  const rightPosters = at(new THREE.Group(), 0, 0, 0) // the current spread's poster planes go in here
  spreadGroup.add(leftPage, rightPage, rightPosters)

  /** The pages' heights for spread i: the left block grows a little as you read on, never by more
   *  than a couple of centimetres, so the open spread lies (nearly) flat. */
  const pagesTop = (i: number) => {
    const all = thick - 2 * BOARD
    const left = all * (0.4 + 0.2 * (n > 1 ? i / (n - 1) : 0))
    return [BOARD + left, BOARD + all - left] as const
  }
  const pageY = { left: 0, right: 0 }
  function setHeights(i: number) {
    const [l, r] = pagesTop(i)
    blocks[0].scale.y = l - BOARD; blocks[1].scale.y = r - BOARD
    pageY.left = l + 0.001; pageY.right = r + 0.001
    leftPage.position.y = pageY.left
    rightPage.position.y = pageY.right
    rightPosters.position.y = pageY.right + 0.002
  }

  // The turning sheet: front and back share the bent vertices; the back's u runs the other way.
  const sheetGeo = new THREE.PlaneGeometry(pw, ph, SEGS, 4).translate(pw / 2, 0, 0).rotateX(-Math.PI / 2)
  const sheetCol = Array.from({ length: sheetGeo.attributes.position.count }, (_, i) =>
    Math.round(sheetGeo.attributes.position.getX(i) / (pw / SEGS)))
  const backGeo = new THREE.BufferGeometry()
  backGeo.setIndex(sheetGeo.index)
  backGeo.setAttribute('position', sheetGeo.attributes.position)
  const backUv = (sheetGeo.attributes.uv as THREE.BufferAttribute).clone()
  for (let i = 0; i < backUv.count; i++) backUv.setX(i, 1 - backUv.getX(i))
  backGeo.setAttribute('uv', backUv)
  const frontMat = ps1Material({ color: '#ffffff', ...FOG })
  const backMat = ps1Material({ color: '#ffffff', ...FOG })
  backMat.side = THREE.BackSide
  const sheet = new THREE.Group()
  for (const m of [new THREE.Mesh(sheetGeo, frontMat), new THREE.Mesh(backGeo, backMat)]) {
    m.frustumCulled = false // its bounds change every frame
    sheet.add(m)
  }
  sheet.visible = false
  spreadGroup.add(sheet)

  function bend(theta: number, y0: number) {
    const ds = pw / SEGS
    const xs = [0], ys = [0]
    for (let k = 1; k <= SEGS; k++) {
      const phi = theta - BEND * Math.sin(theta) * ((k - 0.5) / SEGS)
      xs.push(xs[k - 1] + Math.cos(phi) * ds)
      ys.push(ys[k - 1] + Math.sin(phi) * ds)
    }
    const pos = sheetGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setXY(i, xs[sheetCol[i]], y0 + ys[sheetCol[i]])
    pos.needsUpdate = true
  }

  // Pages for the current spread and its neighbours only.
  const pages = new Map<number, Pages>()
  const get = (i: number) => {
    let p = pages.get(i)
    if (!p) pages.set(i, p = buildPages(spreads[i], pw, ph))
    return p
  }
  function keep(...around: number[]) {
    const want = new Set(around.flatMap((i) => [i - 1, i, i + 1]).filter((i) => i >= 0 && i < n))
    for (const [i, p] of pages) if (!want.has(i)) { p.dispose(); pages.delete(i) }
    for (const i of want) get(i)
  }

  const showLeft = (i: number) => {
    leftMat.uniforms.map.value = get(i).left
    leftMat.uniforms.color.value.set('#ffffff')
  }
  const showRight = (i: number) => {
    rightPosters.clear()
    rightPosters.add(get(i).posters)
  }

  let index = 0
  let opened = false
  let anim: { dir: 1 | -1; t: number } | null = null
  let sheetY: [from: number, to: number] = [0, 0]

  function show(i: number) {
    setHeights(i)
    if (!n) return
    showLeft(i)
    showRight(i)
  }

  function finish() {
    if (!anim) return
    anim = null
    sheet.visible = false
    show(index)
    keep(index)
  }

  if (n) keep(0) // the first spreads are ready before anyone opens the book
  show(0)

  return {
    object,
    open() {
      opened = true
      shut.visible = false
      spreadGroup.visible = true
      show(index)
      keep(index)
    },
    close() {
      finish()
      opened = false
      shut.visible = true
      spreadGroup.visible = false
    },
    isOpen: () => opened,
    turn(dir) {
      if (!opened) return false
      finish()
      const to = index + dir
      if (to < 0 || to >= n) return false
      const from = index
      keep(from, to)
      // Forward: the right page lifts off to show the next one under it; back: the left one does.
      const [over, under] = dir > 0 ? [from, to] : [to, from]
      frontMat.uniforms.map.value = get(over).right
      backMat.uniforms.map.value = get(under).left
      if (dir > 0) showRight(to)
      else showLeft(to)
      index = to
      anim = { dir, t: 0 }
      sheet.visible = true
      // The sheet lifts off the side it lies on and comes down on the other side's height.
      const [l0, r0] = pagesTop(from), [l1, r1] = pagesTop(to)
      sheetY = dir > 0 ? [r0, l1] : [l0, r1]
      bend(dir > 0 ? 0 : Math.PI, sheetY[0] + 0.003)
      return true
    },
    spread: () => index,
    aim(ray) {
      if (!opened || anim || !n) return null
      const p = get(index)
      const inv = object.matrixWorld.clone().invert()
      for (const side of ['left', 'right'] as const) {
        const y = object.position.y + pageY[side] + (side === 'right' ? 0.002 : 0)
        const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3())
        if (!hit) continue
        const local = hit.applyMatrix4(inv)
        const u = (local.x + (side === 'left' ? pw : 0)) / pw, v = (local.z + ph / 2) / pw
        if (u < 0 || u > 1 || v < 0 || v > PAGE_ASPECT) continue
        const inside = (c: Cell) => u >= c.x && u <= c.x + c.w && v >= c.y && v <= c.y + c.h
        if (side === 'left') {
          const a = p.albums.find(inside)
          return a ? { kind: 'album', album: a.album } : null
        }
        const c = p.cells.find(inside)
        return c ? { kind: 'poster', poster: c.poster, meeting: spreads[index].meeting } : null
      }
      return null
    },
    viewPose() {
      // Standing at the table's room side, leaning in, the spread ahead and a little below: aiming
      // at any poster or cover takes little turning (about ±0.5 yaw).
      const pitch = -0.8, dist = 0.85
      const centre = new THREE.Vector3(0, thick, 0.03).applyMatrix4(object.matrixWorld)
      const position = centre.clone().add(new THREE.Vector3(Math.cos(pitch) * dist, -Math.sin(pitch) * dist, 0))
      return { position, yaw: Math.PI / 2, pitch }
    },
    update(dt) {
      if (!anim) return
      anim.t = Math.min(1, anim.t + dt / TURN_TIME)
      const e = ease(anim.t)
      bend(Math.PI * (anim.dir > 0 ? e : 1 - e), sheetY[0] + (sheetY[1] - sheetY[0]) * e + 0.003)
      if (anim.t >= 1) finish()
    },
  }
}
