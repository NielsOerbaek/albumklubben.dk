import * as THREE from 'three'
import { at, coverTexture } from '../ps1/build.ts'
import { painted, rng } from '../ps1/paint.ts'
import { ps1Material } from '../ps1/material.ts'
import type { Album } from '../../../shared/types.ts'
import { SHELF_D, TABLE, type ClubLayout } from './layout.ts'
import { chipboardTex, FLOOR_LIT, FOG, kit, litBox } from './room.ts'

// The library's furniture: the terrazzo table, the shelves, the tan sofa and the chrome chairs,
// the chipboard coffee table and the screen's stand. Lit like the room (`litBox`, FLOOR_LIT).

const { mat } = kit

/** Re-maps a mesh's UVs from its vertex positions, so a repeating texture keeps one scale (a tile
 *  every `tile` metres) on every face, however long the box. */
function tiled<M extends THREE.Mesh>(m: M, tile: number): M {
  const geo = m.geometry
  const pos = geo.attributes.position as THREE.BufferAttribute, n = geo.attributes.normal as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i))
    if (ay > 0.5) uv.setXY(i, x / tile, z / tile)
    else if (ax > 0.5) uv.setXY(i, z / tile, y / tile)
    else uv.setXY(i, x / tile, y / tile)
  }
  return m
}

/** A soft block for upholstery: a box with its edges bevelled by `r`, so cushions read as rounded.
 *  Three cuts a side; the outer ones move in to the bevel, then every vertex is pulled onto a
 *  radius-`r` rounding of the inner box. Shaded per face like `litBox`. */
function softBox(w: number, h: number, d: number, r: number, color: THREE.ColorRepresentation, map: THREE.Texture | null) {
  const geo = new THREE.BoxGeometry(w, h, d, 3, 3, 3)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const half = [w / 2, h / 2, d / 2]
  const p = new THREE.Vector3(), inner = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i)
    for (let a = 0; a < 3; a++) {
      const v = p.getComponent(a), hv = half[a]
      if (Math.abs(Math.abs(v) - hv / 3) < 1e-6) p.setComponent(a, Math.sign(v) * (hv - r))
      inner.setComponent(a, THREE.MathUtils.clamp(p.getComponent(a), -(hv - r), hv - r))
    }
    const off = p.clone().sub(inner)
    if (off.lengthSq() > 0) p.copy(inner).add(off.setLength(r))
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  return new THREE.Mesh(geo, FLOOR_LIT.map((s) => mat(color, map, s)))
}

// ---------------------------------------------------------------------------------------------
// Textures.

/** Terrazzo: pale concrete with dark, grey and warm chips of aggregate. */
const terrazzoTex = () => painted(32, 32, (g) => {
  g.fillStyle = '#dcd8cf'; g.fillRect(0, 0, 32, 32)
  const r = rng(83)
  const chips = ['#6d6862', '#8d887f', '#5a5650', '#a9a296', '#b79f80', '#f3f1ec']
  for (let i = 0; i < 110; i++) {
    g.fillStyle = chips[Math.floor(r() * chips.length)]
    g.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 1 + (r() < 0.2 ? 1 : 0), 1)
  }
}, true)

/** Upholstery: a soft block, pale across its middle and darkening toward its rounded edges, with a
 *  button or two pressed in. Painted in greys; the material's colour makes it tan. */
const cushionTex = () => painted(16, 16, (g) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ex = Math.min(x, 15 - x) / 7.5, ey = Math.min(y, 15 - y) / 7.5 // 0 at the edge, 1 in the middle
    const v = Math.round(255 * (0.62 + 0.38 * Math.sqrt(Math.min(1, Math.min(ex, ey) * 2.2))))
    g.fillStyle = `rgb(${v} ${v} ${v})`
    g.fillRect(x, y, 1, 1)
  }
  g.fillStyle = 'rgb(0 0 0 / 0.14)'
  for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11]]) g.fillRect(x, y, 1, 1) // the buttons
})

// ---------------------------------------------------------------------------------------------

const UPHOLSTERY = '#c9ad8c'
const CHROME = '#c6ccd0'

/** The long table is a precast double-T beam standing on its stems (photos 2 and 7): a thick
 *  terrazzo slab, and under it two webs along its length, set in from its edges and tapering toward
 *  the floor (a wide upper box over a narrower lower one). */
function buildTable(scene: THREE.Scene, t: ClubLayout['table']) {
  const w = t.maxX - t.minX, d = t.maxZ - t.minZ, cx = (t.minX + t.maxX) / 2, cz = (t.minZ + t.maxZ) / 2
  const top = 0.14
  const terrazzo = terrazzoTex()
  scene.add(at(tiled(litBox(w, top, d, '#ffffff', terrazzo, FLOOR_LIT), 0.3), cx, TABLE.h - top / 2, cz))
  const stemH = TABLE.h - top, upper = stemH * 0.45, len = d // the stems run the slab's full length
  const stem = '#d2cfc8' // the same terrazzo, a touch darker in the slab's shadow
  for (const s of [-1, 1]) {
    const x = cx + s * w * 0.25
    scene.add(at(tiled(litBox(0.16, upper, len, stem, terrazzo, FLOOR_LIT), 0.3), x, stemH - upper / 2, cz))
    scene.add(at(tiled(litBox(0.12, stemH - upper, len, stem, terrazzo, FLOOR_LIT), 0.3), x, (stemH - upper) / 2, cz))
  }
}

/** A Camaleonda-like modular sofa: per block a thick seat cushion, a back roll against the wall
 *  side and arm rolls on the two ends, all soft-edged tan blocks with a little gap between. */
function buildSofa(scene: THREE.Scene, blocks: ClubLayout['sofa']) {
  const tex = cushionTex()
  const z0 = Math.min(...blocks.map((b) => b.minZ)), z1 = Math.max(...blocks.map((b) => b.maxZ))
  for (const b of blocks) {
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ, cz = (b.minZ + b.maxZ) / 2
    const g = 0.04 // the soft seam between blocks
    const back = 0.28, seatW = w - back
    scene.add(at(softBox(w - g, 0.2, d - g, 0.06, UPHOLSTERY, tex), (b.minX + b.maxX) / 2, 0.11, cz)) // the base
    scene.add(at(softBox(seatW - g, 0.2, d - g * 2, 0.08, UPHOLSTERY, tex), b.minX + seatW / 2, 0.3, cz)) // the seat
    scene.add(at(softBox(back - g, 0.46, d - g, 0.11, UPHOLSTERY, tex), b.maxX - back / 2, 0.42, cz)) // the back
    for (const [edge, s] of [[z0, 1], [z1, -1]] as const) {
      if (Math.abs((s > 0 ? b.minZ : b.maxZ) - edge) > 1e-6) continue
      scene.add(at(softBox(seatW - g, 0.26, 0.26, 0.1, UPHOLSTERY, tex), b.minX + seatW / 2, 0.42, edge + s * 0.13)) // an arm
    }
  }
}

/** A chrome-framed lounge chair (a sled frame, tan seat and back cushions), facing `ry`. */
function buildChair(scene: THREE.Scene, c: ClubLayout['chairs'][number], ry: number) {
  const tex = cushionTex()
  const g = at(new THREE.Group(), (c.minX + c.maxX) / 2, 0, (c.minZ + c.maxZ) / 2, ry)
  const chrome = mat(CHROME, null, 0.9) // thin tubes: one material, one draw each
  const tube = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const m = at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), chrome), x, y, z)
    m.rotation.x = rx
    g.add(m)
  }
  for (const s of [-1, 1]) {
    const x = s * 0.35
    tube(0.03, 0.03, 0.78, x, 0.015, 0) // the runner on the floor
    tube(0.03, 0.42, 0.03, x, 0.21, 0.37) // up at the front
    tube(0.03, 0.03, 0.62, x, 0.56, 0.06) // the arm
    tube(0.03, 0.8, 0.03, x, 0.42, -0.3, -0.38) // the back, leaning
    tube(0.03, 0.03, 0.66, x, 0.3, 0.02, 0.18) // under the seat
  }
  const seat = at(softBox(0.66, 0.12, 0.58, 0.05, UPHOLSTERY, tex), 0, 0.38, 0.08)
  seat.rotation.x = -0.14
  const back = at(softBox(0.66, 0.62, 0.12, 0.05, UPHOLSTERY, tex), 0, 0.72, -0.27)
  back.rotation.x = -0.38
  g.add(seat, back)
  scene.add(g)
}

/** The low chipboard coffee table: a thick top on two panel ends and a shelf. */
function buildCoffeeTable(scene: THREE.Scene, t: ClubLayout['coffeeTable']) {
  const chip = chipboardTex()
  const w = t.maxX - t.minX, d = t.maxZ - t.minZ, cx = (t.minX + t.maxX) / 2, cz = (t.minZ + t.maxZ) / 2
  const h = 0.42
  scene.add(at(tiled(litBox(w, 0.06, d, '#ffffff', chip, FLOOR_LIT), 0.6), cx, h - 0.03, cz))
  for (const s of [-1, 1]) scene.add(at(tiled(litBox(w - 0.08, h - 0.06, 0.05, '#ffffff', chip, FLOOR_LIT), 0.6), cx, (h - 0.06) / 2, cz + s * (d / 2 - 0.12)))
  scene.add(at(tiled(litBox(w - 0.08, 0.04, d - 0.28, '#ffffff', chip, FLOOR_LIT), 0.6), cx, 0.12, cz))
}

// ---------------------------------------------------------------------------------------------
// The shelves: deep chipboard planks between the +X columns, sparsely dressed with records.

const SHELF_Y = [0.32, 0.8, 1.28, 1.76, 2.24] // the planks' tops
const EYE = 2 // the shelf at eye height gets the latest covers
const REC = 0.31

/** One material per album, shared by every copy on the shelves; the cover arrives when loaded. */
function recordMaterials() {
  const mats = new Map<number, THREE.ShaderMaterial>()
  return (album: Album) => {
    let m = mats.get(album.id)
    if (!m) {
      const face = m = ps1Material({ color: new THREE.Color(album.cardColor).multiplyScalar(0.9), ...FOG })
      mats.set(album.id, m)
      coverTexture(album)?.then((t) => {
        face.uniforms.map.value = t
        face.uniforms.color.value.setScalar(0.92)
      }).catch(() => {}) // a missing cover leaves the plain sleeve
    }
    return m
  }
}

/** Every album in the bins, newest first: the latest meeting's, then by meeting (ids follow the
 *  meetings' order). */
function albumsNewestFirst(layout: ClubLayout): Album[] {
  const seen = new Map<number, Album>()
  for (const c of layout.crates) for (const a of c.albums) seen.set(a.id, a)
  const latest = layout.latest?.id
  return [...seen.values()].sort((a, b) =>
    +(b.meetingId === latest) - +(a.meetingId === latest) || b.meetingId - a.meetingId || a.position - b.position)
}

function buildShelves(scene: THREE.Scene, layout: ClubLayout) {
  const hw = layout.width / 2
  const chip = chipboardTex()
  const back = hw - 0.01, front = hw - SHELF_D
  const material = recordMaterials()
  const albums = albumsNewestFirst(layout)
  const latest = albums.slice(0, layout.shelves.length * 3)
  const older = albums.slice(latest.length)
  let next = 0
  const r = rng(101)
  const take = () => older.length ? older[next++ % older.length] : null

  const recordGeo = new THREE.BoxGeometry(0.006, REC, REC).translate(0, REC / 2, 0)
  // A record standing face-out on a plank: its face to -X, leaning back against the wall.
  const record = (album: Album, y: number, z: number, lean = 0) => {
    const m = new THREE.Mesh(recordGeo, material(album))
    m.position.set(back - 0.05, y, z)
    m.rotation.z = -0.1 // its top against the wall
    m.rotation.x = lean // tipped sideways onto its neighbour
    scene.add(m)
  }
  const sleeveGeo = new THREE.BoxGeometry(REC, 0.012, REC)
  // A small stack lying flat: sleeves seen edge-on, each a touch askew.
  const stack = (y: number, z: number) => {
    const n = 2 + Math.floor(r() * 4)
    for (let i = 0; i < n; i++) {
      const album = take()
      const m = new THREE.Mesh(sleeveGeo, mat(album?.cardColor ?? '#d8d2c4', null, 0.85))
      m.position.set(front + SHELF_D / 2 + 0.02, y + 0.006 + i * 0.013, z)
      m.rotation.y = (r() - 0.5) * 0.25
      scene.add(m)
    }
  }

  layout.shelves.forEach((bay, b) => {
    const len = bay.z1 - bay.z0, cz = (bay.z0 + bay.z1) / 2
    for (const y of SHELF_Y) {
      scene.add(at(tiled(litBox(SHELF_D, 0.035, len, '#ffffff', chip, FLOOR_LIT), 0.6), hw - SHELF_D / 2, y - 0.0175, cz))
    }
    SHELF_Y.forEach((y, row) => {
      if (row === EYE) {
        // The latest covers, three to a bay, spaced out.
        latest.slice(b * 3, b * 3 + 3).forEach((album, i) => record(album, y, bay.z1 - 0.45 - i * (len - 0.7) / 2))
        return
      }
      if (row === SHELF_Y.length - 1 && b % 2) return // a bare top shelf here and there
      // Sparse: from the bay's start, a few things with gaps, like the books in the photos.
      let z = bay.z1 - 0.2 - r() * 0.4
      while (z > bay.z0 + 0.35) {
        const pick = r()
        if (pick < 0.35) {
          const album = take()
          if (album) record(album, y, z - REC / 2, 0)
          z -= REC + 0.2 + r() * 0.5
        } else if (pick < 0.6) {
          // Two or three leaning together on their side, the last one tipped over onto the rest.
          const n = 2 + Math.floor(r() * 2)
          for (let i = 0; i < n; i++) {
            const album = take()
            if (album) record(album, y, z - REC / 2 - i * 0.012)
          }
          const album = take()
          if (album) record(album, y, z - REC / 2 - n * 0.012 - 0.06, -0.32)
          z -= REC + 0.3 + r() * 0.5
        } else if (pick < 0.85) {
          stack(y, z - REC / 2)
          z -= REC + 0.25 + r() * 0.4
        } else z -= 0.4 + r() * 0.5
      }
    })
  })
}

// ---------------------------------------------------------------------------------------------
// The screen's stand: two black posts on feet, a bezel and a back box. The picture is scene.ts's.

export const SCREEN_Y = 1.45 // the picture's centre

function buildScreenStand(scene: THREE.Scene, sc: ClubLayout['screen']) {
  const black = '#1d1e20'
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
    scene.add(at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(black)), x, y, z))
  box(sc.w + 0.05, sc.h + 0.05, 0.045, sc.x, SCREEN_Y, sc.z) // the bezel
  box(sc.w * 0.55, sc.h * 0.6, 0.06, sc.x, SCREEN_Y, sc.z - 0.05) // the back box
  for (const s of [-1, 1]) {
    const x = sc.x + s * sc.w * 0.3
    box(0.07, SCREEN_Y + 0.15, 0.05, x, (SCREEN_Y + 0.15) / 2, sc.z - 0.09) // a post
    box(0.08, 0.04, 0.5, x, 0.02, sc.z - 0.09) // its foot
  }
  box(sc.w * 0.6 + 0.07, 0.06, 0.04, sc.x, SCREEN_Y - 0.15, sc.z - 0.09) // the crossbar
  box(sc.w * 0.6 + 0.07, 0.05, 0.05, sc.x, 0.22, sc.z - 0.09) // the low rail
}

export function buildFurniture(scene: THREE.Scene, layout: ClubLayout) {
  buildTable(scene, layout.table)
  buildSofa(scene, layout.sofa)
  // The chairs face the sofa (+X) across the coffee table.
  for (const c of layout.chairs) buildChair(scene, c, Math.PI / 2)
  buildCoffeeTable(scene, layout.coffeeTable)
  buildShelves(scene, layout)
  buildScreenStand(scene, layout.screen)
}
