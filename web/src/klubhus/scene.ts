import * as THREE from 'three'
import { at, coverTexture } from '../ps1/build.ts'
import { fitText, fontsReady, painted, rng, speckle } from '../ps1/paint.ts'
import { ps1Material } from '../ps1/material.ts'
import type { Album } from '../../../shared/types.ts'
import { TABLE, type ClubLayout, type CrateSpec } from './layout.ts'
import { BOARD, boardLines, createFlipBoard, type FlipBoard } from './flipsign.ts'
import { buildRoom, FOG, kit } from './room.ts'

const { mat, shadedBox } = kit

// ---------------------------------------------------------------------------------------------
// Textures, painted on small canvases so they stay hard-pixelled.

const woodTex = (base: string, line: string, seed: number) => painted(16, 16, (g) => {
  g.fillStyle = base; g.fillRect(0, 0, 16, 16)
  g.fillStyle = line
  const r = rng(seed)
  for (let y = 1; y < 16; y += 3) g.fillRect(0, y, 16, 1)
  for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 3, 1)
}, true)

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
  /** The screen at the far end, showing the latest meeting on its split-flap board. */
  screen: FlipBoard
  /** `player` is where you stand, or null to leave the screen as it is. */
  update(dt: number, player: { x: number; z: number } | null): void
}

const SCREEN_NEAR = 6 // the screen flips when you come this close to it...
const SCREEN_REARM = 9 // ...and again once you have been this far away
const SCREEN_Y = 1.45 // the picture's centre

export async function buildClub(layout: ClubLayout): Promise<Club> {
  await fontsReady()
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(FOG.fogColor)
  buildRoom(scene, layout)

  // The long table, plain for now.
  const t = layout.table
  const tw = t.maxX - t.minX, td = t.maxZ - t.minZ
  scene.add(at(shadedBox(tw, TABLE.h, td, '#c9c6be'), (t.minX + t.maxX) / 2, TABLE.h / 2, (t.minZ + t.maxZ) / 2))

  // The screen on a black stand, facing down the room; its picture is the flip board, glowing.
  const sc = layout.screen
  const screen = createFlipBoard(layout.latest ? boardLines(layout.latest, BOARD.cols, BOARD.rows)
    : Array.from({ length: BOARD.rows }, () => ' '.repeat(BOARD.cols)))
  scene.add(at(shadedBox(sc.w + 0.06, sc.h + 0.06, 0.06, '#1b1c1d'), sc.x, SCREEN_Y, sc.z))
  scene.add(at(shadedBox(0.08, SCREEN_Y, 0.06, '#1b1c1d'), sc.x, SCREEN_Y / 2, sc.z - 0.06))
  scene.add(at(shadedBox(0.7, 0.04, 0.45, '#1b1c1d'), sc.x, 0.02, sc.z))
  const board = screen.texture.image as HTMLCanvasElement
  const picH = Math.min(sc.h, sc.w * board.height / board.width) // the board at its own shape, black above and below
  scene.add(at(shadedBox(sc.w, sc.h, 0.01, '#050505'), sc.x, SCREEN_Y, sc.z + 0.03))
  scene.add(at(new THREE.Mesh(new THREE.PlaneGeometry(sc.w, picH, 4, 2), mat('#ffffff', screen.texture, 1, true, false)), sc.x, SCREEN_Y, sc.z + 0.036))

  // Crates on the table.
  const crateWood = woodTex('#c79a62', '#a57a46', 23)
  const crates = layout.crates.map((spec) => {
    const { group, view } = buildCrate(spec, TABLE.h, crateWood)
    scene.add(group)
    return view
  })

  let armed = true
  return {
    scene,
    crates,
    screen,
    update(dt, player) {
      for (const crate of crates) crate.update(dt)
      if (player) {
        const d = Math.hypot(player.x - sc.x, player.z - sc.z)
        if (armed && d < SCREEN_NEAR) { screen.trigger(); armed = false }
        else if (d > SCREEN_REARM) armed = true
      }
      screen.update(dt)
    },
  }
}
