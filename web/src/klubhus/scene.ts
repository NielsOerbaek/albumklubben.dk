import * as THREE from 'three'
import { at, coverTexture, createBuilder, plane } from '../ps1/build.ts'
import { fitText, fontsReady, painted, rng, speckle } from '../ps1/paint.ts'
import { ps1Material } from '../ps1/material.ts'
import { loadPixelTexture } from '../ps1/textures.ts'
import type { VideoPoster } from '../ps1/video.ts'
import { textureUrl } from '../api.ts'
import type { Album } from '../../../shared/types.ts'
import { BIN, COFFEE_TABLE, COUCH, COUNTER, TABLE, type ClubLayout, type CrateSpec, type PosterSlot } from './layout.ts'
import { BOARD, boardLines, createFlipBoard, drawPixelText, type FlipBoard } from './flipsign.ts'

export const FOG = { fogColor: 0x1e1610, fogNear: 3, fogFar: 15 }
export const WALL_H = 2.8

// ---------------------------------------------------------------------------------------------
// Textures, painted on small canvases so they stay hard-pixelled.

const floorTex = () => painted(32, 32, (g) => {
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    g.fillStyle = (x + y) % 2 ? '#6e4630' : '#cdbb94'
    g.fillRect(x * 16, y * 16, 16, 16)
  }
  speckle(g, 32, 32, 0.12, 7)
  g.fillStyle = 'rgb(0 0 0 / 0.25)'
  for (const p of [0, 16]) { g.fillRect(p, 0, 1, 32); g.fillRect(0, p, 32, 1) }
}, true)

// Upper wall in warm ochre plaster, a dark panelled wainscot below, one tile per metre.
const WAINSCOT = 0.95
const wallTex = () => painted(32, 64, (g) => {
  const split = Math.round(64 * (1 - WAINSCOT / WALL_H))
  g.fillStyle = '#a8743f'; g.fillRect(0, 0, 32, split)
  speckle(g, 32, split, 0.1, 3)
  g.fillStyle = '#4c2f1d'; g.fillRect(0, split, 32, 64 - split)
  g.fillStyle = '#3a2315'
  for (let x = 0; x < 32; x += 8) g.fillRect(x, split, 1, 64 - split)
  g.fillStyle = '#2a190f'; g.fillRect(0, split, 32, 2)
  g.fillStyle = '#6b4329'; g.fillRect(0, split + 2, 32, 1)
}, true)

const woodTex = (base: string, line: string, seed: number) => painted(16, 16, (g) => {
  g.fillStyle = base; g.fillRect(0, 0, 16, 16)
  g.fillStyle = line
  const r = rng(seed)
  for (let y = 1; y < 16; y += 3) g.fillRect(0, y, 16, 1)
  for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 3, 1)
}, true)

const ceilingTex = () => painted(16, 16, (g) => {
  g.fillStyle = '#3d342b'; g.fillRect(0, 0, 16, 16)
  speckle(g, 16, 16, 0.15, 11)
  g.fillStyle = '#231d17'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 0, 1, 16)
}, true)

/** Shelves of record spines in the club's card colours, four shelves per texture height. */
const spinesTex = (colours: string[]) => painted(128, 64, (g) => {
  const r = rng(29)
  g.fillStyle = '#1c120b'; g.fillRect(0, 0, 128, 64)
  const extra = ['#111111', '#e8e2d4', '#2b2b2b', '#c9c1ae', '#7d1f1a']
  for (let row = 0; row < 4; row++) {
    const top = row * 16 + 2
    for (let x = 0; x < 128;) {
      const w = 1 + Math.floor(r() * 2)
      if (r() < 0.06) { x += 3; continue } // a gap where a record was sold
      const pool = colours.length && r() < 0.7 ? colours : extra
      g.fillStyle = pool[Math.floor(r() * pool.length)]
      g.fillRect(x, top + (r() < 0.2 ? 1 : 0), w, 12)
      x += w
    }
    g.fillStyle = '#3e2718'; g.fillRect(0, top + 12, 128, 2) // the shelf board
  }
}, true)

const GREEN = '#24382c'

const doorTex = () => painted(32, 64, (g) => {
  g.fillStyle = GREEN; g.fillRect(0, 0, 32, 64)
  g.fillStyle = '#1a2a20'; g.fillRect(4, 38, 24, 20); g.fillRect(5, 39, 22, 18)
  g.fillStyle = GREEN; g.fillRect(6, 40, 20, 16)
  g.fillStyle = '#d9c99a'; g.fillRect(5, 5, 22, 28) // the glass, lit from the street
  g.fillStyle = '#efe3bd'; g.fillRect(8, 8, 2, 10); g.fillRect(12, 8, 1, 6)
  g.fillStyle = '#c9a548'; g.fillRect(26, 34, 3, 2) // the handle
})

const windowTex = () => painted(96, 48, (g) => {
  const sky = g.createLinearGradient(0, 0, 0, 48)
  sky.addColorStop(0, '#dfe3d2'); sky.addColorStop(0.6, '#c3c8b4'); sky.addColorStop(1, '#8f907f')
  g.fillStyle = sky; g.fillRect(0, 0, 96, 48)
  g.fillStyle = 'rgb(255 255 255 / 0.25)' // glare
  for (const x of [14, 50, 80]) for (let i = 0; i < 20; i++) g.fillRect(x + i, 30 - i, 3, 1)
  g.fillStyle = GREEN
  g.fillRect(0, 0, 96, 3); g.fillRect(0, 45, 96, 3); g.fillRect(0, 0, 3, 48); g.fillRect(93, 0, 3, 48)
  g.fillRect(31, 0, 2, 48); g.fillRect(63, 0, 2, 48)
})

// No thin border or light weight: single-pixel strokes vanish at a distance in 400 lines.
const signTex = () => painted(256, 40, (g) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 40)
  g.fillStyle = '#fff'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.letterSpacing = '3px'
  fitText(g, 'ALBUMKLUBBEN', 236, 30, 700)
  g.fillText('ALBUMKLUBBEN', 128, 21)
})

/** A divider card: off-white, with the crate's label on a black tab at the top. A long label
 *  ("Folk & country") breaks onto two lines rather than shrinking out of sight. */
const dividerTex = (label: string) => painted(96, 128, (g) => {
  g.fillStyle = '#e9e1cf'; g.fillRect(0, 0, 96, 128)
  speckle(g, 96, 128, 0.06, label.length)
  g.fillStyle = '#000'; g.fillRect(0, 0, 96, 44)
  g.fillStyle = '#fff'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  const size = fitText(g, label, 88, 24)
  const words = label.split(' ')
  if (size >= 18 || words.length < 2) return g.fillText(label, 48, 23)
  const cut = Math.ceil(words.length / 2)
  const lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')]
  fitText(g, lines.reduce((a, b) => (g.measureText(a).width > g.measureText(b).width ? a : b)), 88, 19)
  lines.forEach((line, i) => g.fillText(line, 48, 13 + i * 19))
})

/** Corduroy in fine grey ribs, tinted by the material, worn paler in patches. */
const corduroyTex = () => painted(64, 32, (g) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 32)
  g.fillStyle = '#d6d0c8'
  for (let x = 1; x < 64; x += 2) g.fillRect(x, 0, 1, 32)
  const r = rng(41)
  g.fillStyle = 'rgb(255 255 255 / 0.18)'
  for (let i = 0; i < 5; i++) g.fillRect(Math.floor(r() * 56), Math.floor(r() * 26), 4 + Math.floor(r() * 8), 3 + Math.floor(r() * 4))
  speckle(g, 64, 32, 0.08, 43)
}, true)

/** A dark wine rug with a border and a row of diamonds down the middle. */
const rugTex = () => painted(48, 64, (g) => {
  g.fillStyle = '#2a1311'; g.fillRect(0, 0, 48, 64)
  g.fillStyle = '#4e1f1b'; g.fillRect(4, 4, 40, 56)
  g.fillStyle = '#8a6a42'
  g.fillRect(6, 6, 36, 1); g.fillRect(6, 57, 36, 1); g.fillRect(6, 6, 1, 52); g.fillRect(41, 6, 1, 52)
  g.fillStyle = '#6e2a22'
  for (const cy of [16, 32, 48]) {
    for (let i = 1; i <= 7; i++) { g.fillRect(24 - i, cy - 7 + i, 2 * i, 1); g.fillRect(24 - i, cy + 7 - i, 2 * i, 1) }
  }
  speckle(g, 48, 64, 0.1, 53)
})

/** A cream plaque with the poster's meeting, in the flip sign's type: 5×7 glyphs, 2 texels of margin.
 *  16 mm a texel keeps every stroke at least a pixel wide from 3 m, in 400 lines; "MØDE 123" is 0.82 m. */
const PLAQUE_TEXEL = 0.016
const plaqueTex = (n: number) => {
  const text = `MØDE ${n}`, w = text.length * 6 + 3
  return painted(w, 11, (g) => {
    g.fillStyle = '#e9e1cf'; g.fillRect(0, 0, w, 11)
    g.fillStyle = '#121316'
    drawPixelText(g, text, 2, 2)
  })
}

const { mat, shadedBox } = createBuilder(FOG)

// ---------------------------------------------------------------------------------------------
// Crates.

const REC = 0.31 // records are 0.31 m squares
const GAP = 0.015 // 1.5 cm apart
const BACK_TILT = THREE.MathUtils.degToRad(12) // leaning back in the crate
const FWD_TILT = THREE.MathUtils.degToRad(58) // flipped forward, lying on the ones before
const FLIP_TIME = 0.12
const CRATE = { w: 0.4, d: 0.4, h: 0.2, front: 0.07, wall: 0.02 } // a low front, to flip over
const LAST_PIVOT = -0.115 // the backmost record's bottom edge; the divider stands behind it

interface Record {
  album: Album
  pivot: THREE.Group
  face: THREE.ShaderMaterial
  plain: THREE.Texture // the face's own white texel, for a sleeve without its cover
  from: number
  to: number
  t: number
}

export interface CrateView {
  spec: CrateSpec
  /** World position of the crate's centre, at the height of the records. */
  centre: THREE.Vector3
  /** Index of the record you are looking at. */
  front: number
  frontAlbum(): Album | null
  /** Flips one record forward (1) or back (-1), wrapping round at the ends. */
  flip(dir: 1 | -1): void
  update(dt: number): void
}

function buildCrate(spec: CrateSpec, baseY: number, crateWood: THREE.Texture): { group: THREE.Group; view: CrateView } {
  const group = at(new THREE.Group(), spec.x, baseY, spec.z, spec.rotationY)
  const { w, d, h, front, wall } = CRATE
  group.add(at(shadedBox(w, wall, d, '#ffffff', crateWood), 0, wall / 2, 0))
  for (const s of [-1, 1]) group.add(at(shadedBox(wall, h, d, '#ffffff', crateWood), s * (w - wall) / 2, h / 2, 0))
  group.add(at(shadedBox(w, h, wall, '#ffffff', crateWood), 0, h / 2, -(d - wall) / 2))
  group.add(at(shadedBox(w, front, wall, '#ffffff', crateWood), 0, front / 2, (d - wall) / 2))

  const divider = new THREE.Group()
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.004), mat('#ffffff', dividerTex(spec.label)))
  card.position.y = 0.23
  divider.add(card)
  group.add(at(divider, 0, wall, LAST_PIVOT - GAP))
  divider.rotation.x = -BACK_TILT

  const n = spec.albums.length
  const geo = new THREE.BoxGeometry(REC, REC, 0.005)
  geo.translate(0, REC / 2, 0) // pivot on the bottom edge
  const records: Record[] = spec.albums.map((album, i) => {
    const sleeve = mat(album.cardColor, null, 0.85)
    const face = ps1Material({ color: album.cardColor, ...FOG })
    const r = rng(album.id * 97 + 13)
    const pivot = at(new THREE.Group(), (r() - 0.5) * 0.02, wall, LAST_PIVOT + (n - 1 - i) * GAP)
    // Rolled a touch either way: messy like a real crate, but the sleeves never cut through each other.
    const mesh = new THREE.Mesh(geo, [sleeve, sleeve, mat(album.cardColor), sleeve, face, sleeve])
    mesh.rotation.z = (r() - 0.5) * 0.06
    pivot.add(mesh)
    pivot.rotation.x = -BACK_TILT
    group.add(pivot)
    return { album, pivot, face, plain: face.uniforms.map.value, from: -BACK_TILT, to: -BACK_TILT, t: 1 }
  })

  // The front record shows its cover; so do the ones flipped forward past it (their faces turn
  // down as they fall, and keep the cover while they do). Records behind are plain sleeves.
  const showCovers = () => records.forEach((rec, j) => {
    rec.face.uniforms.map.value = rec.plain
    rec.face.uniforms.color.value.set(rec.album.cardColor)
    if (j > view.front) return
    coverTexture(rec.album)?.then((t) => {
      if (j > view.front) return
      rec.face.uniforms.map.value = t
      rec.face.uniforms.color.value.set('#ffffff')
    }).catch(() => {}) // a missing cover leaves the plain sleeve
  })

  const view: CrateView = {
    spec,
    centre: new THREE.Vector3(spec.x, baseY + 0.2, spec.z),
    front: 0,
    frontAlbum: () => records[view.front]?.album ?? null,
    flip(dir) {
      if (n < 2) return
      view.front = (view.front + dir + n) % n
      records.forEach((rec, j) => {
        const to = j < view.front ? FWD_TILT : -BACK_TILT
        if (to === rec.to) return
        rec.from = rec.pivot.rotation.x
        rec.to = to
        rec.t = 0
      })
      showCovers()
      coverTexture(records[(view.front + 1) % n].album)?.catch(() => {}) // warm the next one
    },
    update(dt) {
      for (const rec of records) {
        if (rec.t >= 1) continue
        rec.t = Math.min(1, rec.t + dt / FLIP_TIME)
        const e = 1 - (1 - rec.t) ** 2
        rec.pivot.rotation.x = rec.from + (rec.to - rec.from) * e
      }
    },
  }
  showCovers()
  return { group, view }
}

// ---------------------------------------------------------------------------------------------
// The club.

export interface Club {
  scene: THREE.Scene
  crates: CrateView[]
  /** One per hung poster whose image loaded, ready for createVideoWall. */
  posterMeshes: VideoPoster<PosterSlot>[]
  board: FlipBoard
  /** `player` is where you stand, or null to leave the flip sign as it is. */
  update(dt: number, player: { x: number; z: number } | null): void
}

const SIGN_NEAR = 5 // the flip sign flips when you come this close to the back wall...
const SIGN_REARM = 8 // ...and again once you have been this far away
const FRAME = 0.025 // a poster frame's border and depth

export async function buildClub(layout: ClubLayout): Promise<Club> {
  // The posters load while the room is built; the club opens with them hung.
  const posterImages = Promise.all(layout.posters.map((slot) =>
    loadPixelTexture(textureUrl(slot.poster.imageUrl, 256)).catch(() => null)))
  await fontsReady()
  const { width: W, depth: D } = layout
  const hw = W / 2, hd = D / 2
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(FOG.fogColor)

  const floor = plane(W, D, mat('#ffffff', floorTex()), 0.8, 0.8)
  floor.rotation.x = -Math.PI / 2
  const ceiling = plane(W, D, mat('#ffffff', ceilingTex()), 0.6, 0.6)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = WALL_H
  scene.add(floor, ceiling)

  const wall = mat('#ffffff', wallTex())
  for (const [x, z, ry, len] of [[0, -hd, 0, W], [0, hd, Math.PI, W], [-hw, 0, Math.PI / 2, D], [hw, 0, -Math.PI / 2, D]]) {
    scene.add(at(plane(len, WALL_H, wall, 1, WALL_H), x, WALL_H / 2, z, ry))
  }

  // Fluorescent tubes over the aisles.
  for (let z = -hd + 1.2; z < hd - 0.6; z += 2.4) {
    for (let x = -hw + 2; x <= hw - 1.9; x += 3) scene.add(at(shadedBox(1.2, 0.05, 0.16, '#fff4d6'), x, WALL_H - 0.04, z))
  }

  // The door, behind you when you come in, and a shop window onto the street. Each is one
  // painted plane on the wall, so nothing can poke through anything at a grazing angle.
  const front = (w: number, h: number, x: number, y: number, tex: THREE.Texture) =>
    scene.add(at(plane(w, h, mat('#ffffff', tex)), x, y, hd - 0.012, Math.PI))
  front(1.0, 2.15, layout.spawn.x, 1.075, doorTex())
  const doormat = plane(1.1, 0.6, mat('#3a2a22'))
  doormat.rotation.x = -Math.PI / 2
  scene.add(at(doormat, layout.spawn.x, 0.006, hd - 0.45))
  const winL = layout.spawn.x + 0.9, winR = layout.counter.minX - 0.4
  if (winR - winL > 1) front(Math.min(winR - winL, 3.6), 1.6, (winL + winR) / 2, 1.65, windowTex())

  // Tables.
  const tableWood = woodTex('#7a5230', '#5e3c22', 5)
  for (const t of layout.tables) {
    const w = t.maxX - t.minX, d = t.maxZ - t.minZ
    const cx = (t.minX + t.maxX) / 2, cz = (t.minZ + t.maxZ) / 2
    scene.add(at(shadedBox(w - 0.06, TABLE.h - 0.04, d - 0.06, '#8a6a4a', tableWood), cx, (TABLE.h - 0.04) / 2, cz))
    scene.add(at(shadedBox(w, 0.04, d, '#c49a6c', tableWood), cx, TABLE.h - 0.02, cz))
  }

  // Waist-high record bins along the side walls, spines showing on the room side.
  const spines = spinesTex(layout.crates.flatMap((c) => c.albums.map((a) => a.cardColor)))
  const binWood = woodTex('#4a2f1c', '#3a2416', 9)
  for (const b of layout.bins) {
    const len = b.maxZ - b.minZ, cz = (b.minZ + b.maxZ) / 2
    const side = Math.sign(b.minX + b.maxX)
    scene.add(at(shadedBox(BIN.d, BIN.h, len, '#ffffff', binWood), side * (hw - BIN.d / 2), BIN.h / 2, cz))
    const face = plane(len - 0.1, BIN.h - 0.2, mat('#ffffff', spines), 1.6, 1.9)
    scene.add(at(face, side * (hw - BIN.d - 0.005), BIN.h / 2, cz, -side * Math.PI / 2))
  }

  // The counter, with a till and a turntable playing the newest record.
  const c = layout.counter
  const cw = c.maxX - c.minX, ccx = (c.minX + c.maxX) / 2, ccz = (c.minZ + c.maxZ) / 2
  const counterWood = woodTex('#5a3520', '#43271a', 17)
  scene.add(at(shadedBox(cw, COUNTER.h - 0.05, COUNTER.d, '#ffffff', counterWood), ccx, (COUNTER.h - 0.05) / 2, ccz))
  scene.add(at(shadedBox(cw + 0.06, 0.05, COUNTER.d + 0.08, '#d0b089', tableWood), ccx, COUNTER.h - 0.025, ccz))
  scene.add(at(shadedBox(0.36, 0.2, 0.3, '#9c9686'), c.maxX - 0.45, COUNTER.h + 0.1, ccz))
  scene.add(at(shadedBox(0.3, 0.06, 0.12, '#2f2f2f'), c.maxX - 0.45, COUNTER.h + 0.23, ccz + 0.04))
  const deckX = c.maxX - 1.2
  scene.add(at(shadedBox(0.46, 0.08, 0.36, '#2a2623'), deckX, COUNTER.h + 0.04, ccz))
  const platter = new THREE.Group()
  const newest = layout.crates[0]?.albums[0]
  platter.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 14), mat('#111111')))
  platter.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.014, 8), mat(newest?.cardColor ?? '#c33')), 0, 0, 0))
  scene.add(at(platter, deckX - 0.04, COUNTER.h + 0.087, ccz))

  // The listening corner: a worn corduroy couch facing the back wall, on a rug, with a low table
  // and the newest records lying on it.
  const rug = layout.rug
  const rugMesh = plane(rug.maxX - rug.minX, rug.maxZ - rug.minZ, mat('#ffffff', rugTex()))
  rugMesh.rotation.x = -Math.PI / 2
  scene.add(at(rugMesh, (rug.minX + rug.maxX) / 2, 0.004, (rug.minZ + rug.maxZ) / 2))

  const cord = corduroyTex()
  const couch = layout.couch
  const couchX = (couch.minX + couch.maxX) / 2
  // Arms and a low back frame round a base; two seat cushions, and two back cushions leaning on the
  // frame and standing above it, so the couch reads as one from behind too.
  const ARM = 0.22, LEGS = 0.08, BASE = 0.26, SEAT = 0.15, FRAME_D = 0.16, CUSHION_D = 0.14
  const inner = COUCH.w - 2 * ARM, mid = (couch.minZ + couch.maxZ) / 2
  const seatTop = LEGS + BASE
  for (const s of [-1, 1]) {
    scene.add(at(shadedBox(ARM, 0.62 - LEGS, COUCH.d, '#8a6326', cord), couchX + s * (COUCH.w - ARM) / 2, LEGS + (0.62 - LEGS) / 2, mid))
    for (const z of [couch.minZ + 0.06, couch.maxZ - 0.06]) scene.add(at(shadedBox(0.06, LEGS, 0.06, '#2a1a10'), couchX + s * (COUCH.w / 2 - 0.08), LEGS / 2, z))
  }
  scene.add(at(shadedBox(inner, BASE, COUCH.d, '#7d5a22', cord), couchX, LEGS + BASE / 2, mid))
  scene.add(at(shadedBox(inner, 0.72 - seatTop, FRAME_D, '#7a5620', cord), couchX, (seatTop + 0.72) / 2, couch.maxZ - FRAME_D / 2))
  const seatD = COUCH.d - FRAME_D - CUSHION_D
  const backH = COUCH.h - seatTop - SEAT
  for (const s of [-1, 1]) {
    const tint = s < 0 ? '#b08a38' : '#a8823a'
    scene.add(at(shadedBox(inner / 2 - 0.015, SEAT, seatD - 0.02, tint, cord), couchX + s * inner / 4, seatTop + SEAT / 2, couch.minZ + seatD / 2))
    const back = at(shadedBox(inner / 2 - 0.02, backH, CUSHION_D, tint, cord), couchX + s * inner / 4, seatTop + SEAT + backH / 2, couch.maxZ - FRAME_D - CUSHION_D / 2 + 0.02)
    back.rotation.x = -0.12 // leaning back
    scene.add(back)
  }

  const ct = layout.coffeeTable
  const ctx = (ct.minX + ct.maxX) / 2, ctz = (ct.minZ + ct.maxZ) / 2
  const darkWood = woodTex('#5c3b22', '#472c18', 31)
  scene.add(at(shadedBox(COFFEE_TABLE.w, 0.04, COFFEE_TABLE.d, '#ffffff', darkWood), ctx, COFFEE_TABLE.h - 0.02, ctz))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    scene.add(at(shadedBox(0.05, COFFEE_TABLE.h - 0.04, 0.05, '#c9b8a6', darkWood), ctx + sx * (COFFEE_TABLE.w / 2 - 0.06), (COFFEE_TABLE.h - 0.04) / 2, ctz + sz * (COFFEE_TABLE.d / 2 - 0.06)))
  }
  layout.latest?.albums.slice(0, 2).forEach((album, i) => scene.add(at(shadedBox(0.31, 0.006, 0.31, album.cardColor),
    ctx - 0.18 + i * 0.3, COFFEE_TABLE.h + 0.003 + i * 0.006, ctz + (i ? 0.03 : -0.02), i ? -0.35 : 0.2)))

  // The flip sign on the back wall, in a black case, with the club's name over it.
  const { sign } = layout
  const board = createFlipBoard(layout.latest ? boardLines(layout.latest, BOARD.cols, BOARD.rows)
    : Array.from({ length: BOARD.rows }, () => ' '.repeat(BOARD.cols)))
  scene.add(at(shadedBox(sign.w + 0.1, sign.h + 0.1, 0.06, '#1c1b19'), sign.x, sign.y, -hd + 0.03))
  scene.add(at(plane(sign.w, sign.h, mat('#ffffff', board.texture), sign.w, sign.h, 0.2), sign.x, sign.y, -hd + 0.075))
  const nameH = 0.24
  scene.add(at(plane(nameH * 6.4, nameH, mat('#ffffff', signTex())), sign.x, sign.y + sign.h / 2 + 0.05 + 0.03 + nameH / 2, -hd + 0.02))

  // Posters, each fitted inside its slot at its own shape, in a thin black frame, with its meeting
  // on a plaque underneath. A poster whose image would not load leaves an empty frame and its plaque.
  const images = await posterImages
  const plaques = new Map<number, THREE.Texture>()
  const posterMeshes: VideoPoster<PosterSlot>[] = []
  layout.posters.forEach((slot, i) => {
    const image = images[i]
    const img = image?.image as { width: number; height: number } | undefined
    const aspect = img ? img.width / img.height : slot.width / slot.height
    const w = Math.min(slot.width, slot.height * aspect), h = w / aspect
    const g = at(new THREE.Group(), slot.x, slot.y, slot.z, Math.atan2(slot.normalX, slot.normalZ))
    g.add(at(shadedBox(w + 2 * FRAME, h + 2 * FRAME, FRAME, image ? '#161514' : '#2a2724'), 0, 0, FRAME / 2))
    let plaque = plaques.get(slot.meetingNumber)
    if (!plaque) plaques.set(slot.meetingNumber, plaque = plaqueTex(slot.meetingNumber))
    const { width: pw, height: ph } = plaque.image as HTMLCanvasElement
    g.add(at(plane(pw * PLAQUE_TEXEL, ph * PLAQUE_TEXEL, mat('#ffffff', plaque)), 0, -h / 2 - FRAME - 0.03 - ph * PLAQUE_TEXEL / 2, 0.01))
    if (image) {
      const picture = at(plane(w, h, ps1Material({ map: image, ...FOG }), w, h, 0.2), 0, 0, FRAME + 0.012)
      const backing = at(plane(w, h, mat('#000000')), 0, 0, FRAME + 0.006)
      backing.visible = false
      g.add(picture, backing)
      posterMeshes.push({ item: slot, picture, image, aspect, backing })
    }
    scene.add(g)
  })

  // Crates: the genre crates on the tables, Nyt on the counter.
  const crateWood = woodTex('#c79a62', '#a57a46', 23)
  const crates = layout.crates.map((spec) => {
    const { group, view } = buildCrate(spec, spec.id === 'nyt' ? COUNTER.h : TABLE.h, crateWood)
    scene.add(group)
    return view
  })

  let armed = true
  return {
    scene,
    crates,
    posterMeshes,
    board,
    update(dt, player) {
      platter.rotation.y -= dt * 3.5 // 33 rpm
      for (const crate of crates) crate.update(dt)
      if (player) {
        const fromBack = player.z + hd
        if (armed && fromBack < SIGN_NEAR) { board.trigger(); armed = false }
        else if (fromBack > SIGN_REARM) armed = true
      }
      board.update(dt)
    },
  }
}
