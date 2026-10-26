import * as THREE from 'three'
import { inkFor } from '../album.ts'
import { at, coverTexture, createBuilder, plane } from '../ps1/build.ts'
import { ps1Material } from '../ps1/material.ts'
import { fitText, fontsReady, painted, rng, speckle } from '../ps1/paint.ts'
import type { Album } from '../../../shared/types.ts'
import { CEILING, DOOR, HALL_W, PLAQUE, WALL_T, type MuseumLayout, type Plaque, type WallItem } from './layout.ts'
import type { VideoPoster } from './video.ts'

const FOG = { fogColor: 0x16130f, fogNear: 7, fogFar: 32 }
const { mat, shadedBox } = createBuilder(FOG)

// The entrance is warm stone; the halls after it take these colours in turn.
const ENTRANCE_WALL = '#9a8d76'
const HALL_WALLS = ['#6b2a25', '#2f4a43', '#34405a', '#7a5a2a']
const STONE = '#d6cdbb'
const DARK_INK = '#1a1612'
const LIGHT_INK = '#efe9dc'
// Frames are four bars standing FRAME_DEPTH off the wall with the picture set back inside them,
// so no face lies just in front of another: vertex snapping makes close layers poke through.
const FRAME_DEPTH = 0.05
const PICTURE_Z = 0.03
const PICTURE_STEP = 0.2 // finer cuts on pictures keep the affine warp small up close
const DECAL = 0.03 // words painted on a wall stand this far off it
const SURROUND = 0.2 // the stone around a doorway
const SKYLIGHT_W = 2.4

// ---------------------------------------------------------------------------------------------
// Textures.

const floorTex = () => painted(32, 32, (g) => {
  // Oak parquet, staggered planks a hand wide; one tile per metre.
  const r = rng(5)
  const browns = ['#6b4a2c', '#74512f', '#5f4127', '#7b5833']
  for (let row = 0; row < 8; row++) {
    const shift = row % 2 ? 8 : 0
    for (let x = -shift; x < 32; x += 16) {
      g.fillStyle = browns[Math.floor(r() * browns.length)]
      g.fillRect(x, row * 4, 16, 4)
      g.fillStyle = 'rgb(0 0 0 / 0.35)'
      g.fillRect(x, row * 4, 1, 4)
    }
    g.fillStyle = 'rgb(0 0 0 / 0.3)'
    g.fillRect(0, row * 4 + 3, 32, 1)
  }
  speckle(g, 32, 32, 0.08, 3)
}, true)

/** A wall the full height of the hall, one tile per metre across: a dark skirting board, the
 *  painted wall (a touch darker low down), a picture rail and a pale cornice under the ceiling. */
const wallTexs = new Map<string, THREE.Texture>()
function wallTex(colour: string) {
  let tex = wallTexs.get(colour)
  if (!tex) wallTexs.set(colour, tex = painted(16, 96, (g) => {
    const px = (m: number) => Math.round(96 * (1 - m / CEILING)) // metres up the wall to a pixel row
    const fade = g.createLinearGradient(0, 0, 0, 96)
    fade.addColorStop(0, 'rgb(0 0 0 / 0)')
    fade.addColorStop(1, 'rgb(0 0 0 / 0.28)')
    g.fillStyle = colour; g.fillRect(0, 0, 16, 96)
    g.fillStyle = fade; g.fillRect(0, 0, 16, 96)
    speckle(g, 16, 96, 0.06, colour.length * 7)
    g.fillStyle = STONE; g.fillRect(0, 0, 16, px(CEILING - 0.45))
    g.fillStyle = 'rgb(0 0 0 / 0.25)'; g.fillRect(0, px(CEILING - 0.45), 16, 1)
    g.fillStyle = '#3a2d22'; g.fillRect(0, px(3.4), 16, 1) // the picture rail
    g.fillStyle = '#2a221c'; g.fillRect(0, px(0.18), 16, 96 - px(0.18)) // skirting
  }, true))
  return tex
}

const ceilingTex = () => painted(16, 16, (g) => {
  // Coffers, one per 1.5 m.
  g.fillStyle = '#b9b2a2'; g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#a49d8d'; g.fillRect(3, 3, 10, 10)
  g.fillStyle = '#8f8878'; g.fillRect(3, 3, 10, 1); g.fillRect(3, 3, 1, 10)
}, true)

const skylightTex = () => painted(16, 16, (g) => {
  g.fillStyle = '#f2efe4'; g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#e1dccd'; g.fillRect(8, 8, 8, 8); g.fillRect(0, 0, 8, 8)
  g.fillStyle = '#6f6a5f'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 0, 1, 16)
}, true)

const woodTex = () => painted(16, 16, (g) => {
  g.fillStyle = '#3a2416'; g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#2a190f'
  const r = rng(13)
  for (let y = 1; y < 16; y += 3) g.fillRect(0, y, 16, 1)
  for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 3, 1)
}, true)

/** Words on the wall: transparent around the letters, so only the letters show. */
const wallText = (text: string, ink: string, w: number, h: number, weight = 600) => painted(w, h, (g) => {
  g.fillStyle = ink
  g.textAlign = 'center'; g.textBaseline = 'middle'
  fitText(g, text, w - 8, Math.round(h * 0.78), weight)
  g.fillText(text, w / 2, h / 2 + 1)
})

/** The front door: tall double doors in dark wood with brass handles. */
const doorTex = () => painted(32, 48, (g) => {
  g.fillStyle = '#2c1d13'; g.fillRect(0, 0, 32, 48)
  g.fillStyle = '#20150d'
  for (const x of [3, 18]) { g.fillRect(x, 3, 11, 18); g.fillRect(x, 25, 11, 20) }
  g.fillStyle = '#3a2819'
  for (const x of [4, 19]) { g.fillRect(x, 4, 9, 16); g.fillRect(x, 26, 9, 18) }
  g.fillStyle = '#120c08'; g.fillRect(15, 0, 2, 48)
  g.fillStyle = '#c9a548'; g.fillRect(13, 24, 2, 3); g.fillRect(17, 24, 2, 3)
})

/** The directory by the entrance: every hall, in walking order. */
const directoryTex = (titles: string[]) => painted(192, 240, (g) => {
  g.fillStyle = '#111'; g.fillRect(0, 0, 192, 240)
  g.fillStyle = LIGHT_INK
  g.textAlign = 'left'; g.textBaseline = 'top'
  fitText(g, 'SALENE', 168, 22, 600)
  g.fillText('SALENE', 12, 12)
  g.fillRect(12, 40, 168, 2)
  const line = Math.min(20, Math.floor(184 / Math.max(titles.length, 1)))
  titles.forEach((t, i) => {
    fitText(g, t, 168, line - 3, 600)
    g.fillText(t, 12, 50 + i * line)
  })
})

const plaqueTex = (lines: string[]) => painted(128, 80, (g) => {
  g.fillStyle = '#ebe5d6'; g.fillRect(0, 0, 128, 80)
  g.fillStyle = '#1a1a1a'
  g.textAlign = 'left'; g.textBaseline = 'top'
  lines.forEach((l, i) => {
    fitText(g, l, 112, i ? 13 : 18, i ? 400 : 600)
    g.fillText(l, 8, 8 + (i ? 24 + (i - 1) * 18 : 0))
  })
})

/** A cover without an image: the album's card colour with its artist and title. */
const noCoverTex = (album: Album) => painted(64, 64, (g) => {
  g.fillStyle = album.cardColor; g.fillRect(0, 0, 64, 64)
  g.fillStyle = inkFor(album.cardColor)
  g.textAlign = 'left'; g.textBaseline = 'top'
  ;[album.artist, album.title].forEach((t, i) => {
    fitText(g, t, 56, 11, 600)
    g.fillText(t, 4, 4 + i * 14)
  })
})

/** A poster whose image would not load: still a poster, with its meeting number. */
const noPosterTex = (n: number) => painted(64, 112, (g) => {
  g.fillStyle = '#1d1d1d'; g.fillRect(0, 0, 64, 112)
  g.fillStyle = '#efe9dc'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  fitText(g, `Møde ${n}`, 56, 14)
  g.fillText(`Møde ${n}`, 32, 56)
})

const playMarkTex = () => painted(16, 16, (g) => {
  g.fillStyle = '#e8c872'
  g.beginPath(); g.moveTo(4, 2); g.lineTo(14, 8); g.lineTo(4, 14); g.closePath(); g.fill()
})

// ---------------------------------------------------------------------------------------------
// The museum.

/** Turns a group so its +Z points along the wall's normal. */
const facing = (n: { normalX: number; normalZ: number }) => Math.atan2(n.normalX, n.normalZ)

/** A thin board standing on a wall: `face` on its front (+Z), dark edges, its back on the wall. */
function board(w: number, h: number, d: number, face: THREE.Texture) {
  const edge = mat('#1c1612')
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [edge, edge, edge, edge, mat('#ffffff', face), edge])
  mesh.geometry.translate(0, 0, d / 2)
  return mesh
}

/** Light words on a dark wall, dark words on a light one. */
const inkOn = (wall: string) => (inkFor(wall) === '#ffffff' ? LIGHT_INK : DARK_INK)

export interface CoverView { item: WallItem; mesh: THREE.Mesh }
export interface Museum { scene: THREE.Scene; covers: CoverView[]; videoPosters: VideoPoster[] }

/** Builds the halls. `posterImages` holds each poster's loaded 256 px texture (null if it failed). */
export async function buildMuseum(layout: MuseumLayout, posterImages: Map<number, THREE.Texture | null>): Promise<Museum> {
  await fontsReady()
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(FOG.fogColor)
  const hw = HALL_W / 2
  const { halls } = layout
  const start = halls[0].bounds.minX, end = halls.at(-1)!.bounds.maxX
  const length = end - start, mid = (start + end) / 2
  const wallColour = (i: number) => (i ? HALL_WALLS[(i - 1) % HALL_WALLS.length] : ENTRANCE_WALL)

  const floor = plane(length, HALL_W, mat('#ffffff', floorTex()), 1, 1)
  floor.rotation.x = -Math.PI / 2
  floor.position.x = mid
  scene.add(floor)
  const coffers = mat('#ffffff', ceilingTex()), skylight = mat('#ffffff', skylightTex())

  /** The end wall of a hall at `x`, facing `dir` (+1 or -1 along X), with or without a doorway. */
  const endWall = (x: number, dir: 1 | -1, wall: THREE.Material, doorway: boolean) => {
    const ry = dir * Math.PI / 2
    if (!doorway) return scene.add(at(plane(HALL_W, CEILING, wall, 1, CEILING), x, CEILING / 2, 0, ry))
    // The pieces start halfway into the stone surround, so their edges stay hidden in it.
    const open = DOOR.w / 2 + SURROUND / 2, low = DOOR.h + SURROUND / 2
    const side = hw - open
    for (const s of [-1, 1]) scene.add(at(plane(side, CEILING, wall, 1, CEILING), x, CEILING / 2, s * (open + side / 2), ry))
    // Above the door, a slice of the full-height wall texture.
    const above = plane(2 * open, CEILING - low, wall, 1, CEILING)
    const uv = above.geometry.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) + low / CEILING)
    scene.add(at(above, x, (CEILING + low) / 2, 0, ry))
  }

  halls.forEach((hall, i) => {
    const { minX, maxX } = hall.bounds
    const L = maxX - minX, cx = (minX + maxX) / 2
    const wall = mat('#ffffff', wallTex(wallColour(i)))
    scene.add(at(plane(L, CEILING, wall, 1, CEILING), cx, CEILING / 2, -hw, 0))
    scene.add(at(plane(L, CEILING, wall, 1, CEILING), cx, CEILING / 2, hw, Math.PI))
    endWall(minX, 1, wall, i > 0)
    endWall(maxX, -1, wall, i < halls.length - 1)

    // A coffered ceiling with a skylight down the middle, as three strips side by side.
    const sky = SKYLIGHT_W / 2, strip = hw - sky
    for (const [w, z, m, tile] of [[strip, -(sky + strip / 2), coffers, 1.5], [SKYLIGHT_W, 0, skylight, 1.2],
      [strip, sky + strip / 2, coffers, 1.5]] as const) {
      const c = plane(L, w, m, tile, tile)
      c.rotation.x = Math.PI / 2
      c.position.set(cx, CEILING, z)
      scene.add(c)
    }

    // The doorway on to the next hall: a stone surround, and the next hall's name above it.
    if (i < halls.length - 1) {
      const dx = maxX + WALL_T / 2, depth = WALL_T + 0.1, S = SURROUND
      for (const s of [-1, 1]) scene.add(at(shadedBox(depth, DOOR.h + S, S, STONE), dx, (DOOR.h + S) / 2, s * (DOOR.w + S) / 2))
      scene.add(at(shadedBox(depth, S, DOOR.w + 2 * S, STONE), dx, DOOR.h + S / 2, 0))
      const title = wallText(halls[i + 1].title, inkOn(wallColour(i)), 256, 32)
      scene.add(at(plane(4.4, 0.55, mat('#ffffff', title)), maxX - DECAL, DOOR.h + 0.75, 0, -Math.PI / 2))
    }
  })

  // The entrance: the museum's name over the first doorway, the front door behind you, and a
  // directory of the halls on the left.
  const entrance = halls[0].bounds
  const sign = wallText('ALBUMKLUBBEN MUSEUM', inkOn(ENTRANCE_WALL), 256, 30, 700)
  scene.add(at(plane(7.6, 0.8, mat('#ffffff', sign)), entrance.maxX - DECAL, CEILING - 0.88, 0, -Math.PI / 2))
  scene.add(at(board(2.2, 3.3, 0.08, doorTex()), entrance.minX, 1.65, 0, Math.PI / 2))
  if (halls.length > 1) {
    const directory = directoryTex(halls.slice(1).map((h) => h.title))
    scene.add(at(board(2.4, 3, 0.06, directory), (entrance.minX + entrance.maxX) / 2, 1.8, -hw))
  }

  // Benches to sit and look from.
  for (const b of layout.benches) {
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
    scene.add(at(shadedBox(w - 0.3, 0.36, d - 0.16, '#1c1612'), cx, 0.18, cz))
    scene.add(at(shadedBox(w, 0.1, d, '#4a3426'), cx, 0.41, cz))
  }

  // Posters and covers, each in a dark wooden frame.
  const wood = woodTex()
  const frame = (item: WallItem, border: number) => {
    const g = at(new THREE.Group(), item.x, item.y, item.z, facing(item))
    const { width: w, height: h } = item
    const bar = (bw: number, bh: number, x: number, y: number) =>
      g.add(at(shadedBox(bw, bh, FRAME_DEPTH, '#ffffff', wood), x, y, FRAME_DEPTH / 2))
    for (const s of [-1, 1]) {
      bar(w + 2 * border, border, 0, s * (h + border) / 2)
      bar(border, h, s * (w + border) / 2, 0)
    }
    scene.add(g)
    return g
  }
  const picture = <M extends THREE.Material>(item: WallItem, material: M) =>
    at(plane(item.width, item.height, material, item.width, item.height, PICTURE_STEP), 0, 0, PICTURE_Z)
  const playMark = playMarkTex()
  const covers: CoverView[] = []
  const videoPosters: VideoPoster[] = []

  for (const item of layout.items) {
    if (item.kind === 'poster') {
      const border = 0.08
      const g = frame(item, border)
      const image = posterImages.get(item.poster!.id) ?? noPosterTex(item.meetingNumber)
      const hasVideo = !!item.poster!.videoUrl
      // A video poster gets its own material, so its picture can switch to the video.
      const pic = picture(item, hasVideo ? ps1Material({ map: image, ...FOG }) : mat('#ffffff', image))
      g.add(pic)
      if (hasVideo) {
        const backing = at(plane(item.width, item.height, mat('#000000')), 0, 0, PICTURE_Z / 2)
        backing.visible = false
        const mark = at(plane(0.07, 0.07, mat('#ffffff', playMark)), 0, -(item.height + border) / 2, FRAME_DEPTH + 0.004)
        g.add(backing, mark)
        videoPosters.push({ item, picture: pic, image, backing })
      }
    } else {
      const album = item.album!
      const g = frame(item, 0.03)
      const mesh = picture(item, mat(album.cardColor))
      g.add(mesh)
      const tex = coverTexture(album)
      if (tex) tex.then((t) => { mesh.material = mat('#ffffff', t) }).catch(() => { mesh.material = mat('#ffffff', noCoverTex(album)) })
      else mesh.material = mat('#ffffff', noCoverTex(album))
      covers.push({ item, mesh })
    }
  }

  for (const p of layout.plaques) scene.add(plaque(p))

  return { scene, covers, videoPosters }
}

const plaque = (p: Plaque) => at(board(PLAQUE.w, PLAQUE.h, 0.02, plaqueTex(p.lines)), p.x, p.y, p.z, facing(p))
