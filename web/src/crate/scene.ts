import * as THREE from 'three'
import { textureUrl } from '../api.ts'
import { at, coverTexture, createBuilder, plane } from '../ps1/build.ts'
import { fitText, fontsReady, painted, rng, speckle } from '../ps1/paint.ts'
import { ps1Material } from '../ps1/material.ts'
import { loadPixelTexture } from '../ps1/textures.ts'
import type { Album, Poster } from '../../../shared/types.ts'
import { COUNTER, SHELF_DEPTH, TABLE, type CrateSpec, type ShopLayout } from './layout.ts'

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

// No thin border or light weight: single-pixel strokes vanish at a distance in 240 lines.
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
      coverTexture(records[(view.front + 1) % n].album) // warm the next one
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
// The shop.

/** Lays posters out in rows on the back wall, as large as fits. Returns their centres and sizes.
 *  If even the smallest size overflows the wall, the oldest rows are left off. */
function posterRows(aspects: number[], wallW: number, bottom: number, top: number) {
  const gap = 0.07
  for (let k = 18; k >= 4; k--) {
    const h = k * 0.05
    const maxRows = Math.floor((top - bottom + gap) / (h + gap))
    const rows: number[][] = [[]]
    let used = 0
    for (const [i, a] of aspects.entries()) {
      const w = h * a
      if (used && used + gap + w > wallW) { rows.push([]); used = 0 }
      used += (used ? gap : 0) + w
      rows.at(-1)!.push(i)
    }
    if (rows.length > maxRows && k > 4) continue
    rows.splice(0, rows.length - maxRows)
    const out: { i: number; x: number; y: number; w: number; h: number }[] = []
    rows.forEach((row, r) => {
      const rowW = row.reduce((s, i) => s + h * aspects[i], 0) + gap * (row.length - 1)
      let x = -rowW / 2
      const y = top - h / 2 - r * (h + gap)
      for (const i of row) {
        const w = h * aspects[i]
        out.push({ i, x: x + w / 2, y, w, h })
        x += w + gap
      }
    })
    return out
  }
  return []
}

export interface Shop {
  scene: THREE.Scene
  crates: CrateView[]
  update(dt: number): void
}

export async function buildShop(layout: ShopLayout, posters: Poster[]): Promise<Shop> {
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

  // Wall shelves full of spines.
  const spines = spinesTex(layout.crates.flatMap((c) => c.albums.map((a) => a.cardColor)))
  const shelfWood = woodTex('#4a2f1c', '#3a2416', 9)
  for (const s of layout.shelves) {
    const len = s.maxZ - s.minZ, cz = (s.minZ + s.maxZ) / 2
    const side = Math.sign(s.minX + s.maxX)
    scene.add(at(shadedBox(SHELF_DEPTH, 2.1, len, '#ffffff', shelfWood), side * (hw - SHELF_DEPTH / 2), 1.05, cz))
    const face = plane(len - 0.1, 1.9, mat('#ffffff', spines), 1.6, 1.9)
    scene.add(at(face, side * (hw - SHELF_DEPTH - 0.005), 1.05, cz, -side * Math.PI / 2))
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

  // The sign and the meeting posters on the back wall.
  const sign = plane(4, 0.62, mat('#ffffff', signTex()))
  scene.add(at(sign, 0, WALL_H - 0.4, -hd + 0.02))
  const loaded = await Promise.all(posters.map((p) =>
    loadPixelTexture(textureUrl(p.imageUrl, 256)).catch(() => null)))
  const hung = posters.flatMap((p, i) => (loaded[i] ? [{ p, tex: loaded[i]! }] : []))
  const aspects = hung.map(({ tex }) => {
    const img = tex.image as { width: number; height: number }
    return img.width / img.height
  })
  for (const { i, x, y, w, h } of posterRows(aspects, W - 2 * SHELF_DEPTH - 0.6, 1.05, WALL_H - 0.75)) {
    const poster = plane(w, h, mat('#ffffff', hung[i].tex))
    poster.position.set(x, y, -hd + 0.015 + (i % 2) * 0.002)
    poster.rotation.z = (rng(hung[i].p.id * 31)() - 0.5) * 0.05
    scene.add(poster)
  }

  // Crates: the genre crates on the tables, Nyt on the counter.
  const crateWood = woodTex('#c79a62', '#a57a46', 23)
  const crates = layout.crates.map((spec) => {
    const { group, view } = buildCrate(spec, spec.id === 'nyt' ? COUNTER.h : TABLE.h, crateWood)
    scene.add(group)
    return view
  })

  return {
    scene,
    crates,
    update(dt) {
      platter.rotation.y -= dt * 3.5 // 33 rpm
      for (const crate of crates) crate.update(dt)
    },
  }
}
