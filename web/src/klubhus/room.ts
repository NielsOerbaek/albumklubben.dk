import * as THREE from 'three'
import { at, createBuilder, plane } from '../ps1/build.ts'
import { painted, rng, speckle } from '../ps1/paint.ts'
import { loadPixelTexture } from '../ps1/textures.ts'
import { textureUrl } from '../api.ts'
import { BENCH, COLUMN_SIZE, type ClubLayout } from './layout.ts'

// The library's shell: floor, walls, columns, the ceiling and what hangs from it, the window wall
// with its bench, the staircase behind its glass, and the photo collage on the floor. The light is
// faked: daylight from the windows (-X) and the tubes overhead, as a shade per face.

/** Pale, cool and still there at a distance, like the daylight haze in the photos. */
export const FOG = { fogColor: 0xd2d6d9, fogNear: 8, fogFar: 34 }
export const kit = createBuilder(FOG)
const { mat, decal } = kit

export type Shades = [px: number, nx: number, top: number, bottom: number, pz: number, nz: number]
/** On the floor: lit from above and from the windows at -X. */
export const FLOOR_LIT: Shades = [0.62, 0.95, 1, 0.4, 0.8, 0.7]
/** Hung from the ceiling: lit from below by the tubes and the daylight. */
export const CEILING_LIT: Shades = [0.5, 0.7, 0.42, 0.86, 0.6, 0.56]

/** A box with a shade per face; cut every 0.5 m like `shadedBox`, so the affine warp stays small. */
export function litBox(w: number, h: number, d: number, color: THREE.ColorRepresentation, map: THREE.Texture | null, shades: Shades) {
  const seg = (n: number) => Math.max(1, Math.ceil(n / 0.5))
  const geo = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d))
  return new THREE.Mesh(geo, shades.map((s) => mat(color, map, s)))
}

/** Unshaded and unfogged: reads as light in an unlit renderer. */
const glow = (color: THREE.ColorRepresentation, map: THREE.Texture | null = null) => mat(color, map, 1, false, false)

/** y += k·x: a box or plane laid along a slope with its ends kept upright, like a stair stringer. */
const shear = <G extends THREE.BufferGeometry>(geo: G, k: number) =>
  geo.applyMatrix4(new THREE.Matrix4().makeShear(k, 0, 0, 0, 0, 0)) // three's `xy` is y += xy·x

/** Flattens every vertex above `max` down to it, so nothing pokes through the ceiling. */
function clampY<G extends THREE.BufferGeometry>(geo: G, max: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.min(pos.getY(i), max))
  return geo
}

/** Repeats a texture `n` times along the geometry's u. */
function repeatU<G extends THREE.BufferGeometry>(geo: G, n: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * n)
  return geo
}

// ---------------------------------------------------------------------------------------------
// Textures, painted on small canvases so they stay hard-pixelled.

export const concreteTex = (base: string, seed: number) => painted(32, 32, (g) => {
  g.fillStyle = base; g.fillRect(0, 0, 32, 32)
  const r = rng(seed)
  g.fillStyle = 'rgb(0 0 0 / 0.05)'
  for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 28), Math.floor(r() * 28), 3 + Math.floor(r() * 6), 2 + Math.floor(r() * 4))
  speckle(g, 32, 32, 0.1, seed + 1)
}, true)

/** Board-formed concrete: pale grey, the boards' joints as faint horizontal lines, dark aggregate. */
const columnTex = () => painted(16, 128, (g) => {
  g.fillStyle = '#b3b2aa'; g.fillRect(0, 0, 16, 128)
  const r = rng(17)
  for (let y = 0; y < 128; y += 6) {
    g.fillStyle = `rgb(0 0 0 / ${r() * 0.03})`; g.fillRect(0, y, 16, 6) // each board a touch different
    g.fillStyle = 'rgb(0 0 0 / 0.045)'; g.fillRect(0, y, 16, 1)
  }
  speckle(g, 16, 128, 0.06, 19)
})

const floorTex = () => painted(32, 32, (g) => {
  g.fillStyle = '#d3d5d4'; g.fillRect(0, 0, 32, 32)
  speckle(g, 32, 32, 0.04, 5)
}, true)

const wallTex = () => painted(16, 16, (g) => {
  g.fillStyle = '#efeeea'; g.fillRect(0, 0, 16, 16)
  speckle(g, 16, 16, 0.03, 3)
}, true)

/** Daylight through the glass: the building across the courtyard, pale and washed out. One bay. */
const facadeTex = () => painted(48, 48, (g) => {
  const sky = g.createLinearGradient(0, 0, 0, 48)
  sky.addColorStop(0, '#fbfcfc'); sky.addColorStop(1, '#e9eceb')
  g.fillStyle = sky; g.fillRect(0, 0, 48, 48)
  for (let row = 0; row < 3; row++) {
    const y = 4 + row * 15
    g.fillStyle = '#e4e8e9'; g.fillRect(0, y + 10, 48, 2) // the floor band
    for (let x = 3; x < 48; x += 12) {
      g.fillStyle = '#cbd3d8'; g.fillRect(x, y, 8, 9) // a window across the way
      g.fillStyle = '#f2f4f4'; g.fillRect(x + 4, y, 1, 9)
    }
  }
})

/** Sheer white curtain: folds as stripes, with gaps you see the daylight through. */
const curtainTex = () => painted(16, 8, (g) => {
  const cols = ['#f6f6f3', '#ffffff', '#e2e2de', null, '#fbfbf9', '#ebebe7', null, '#f2f2ef']
  for (let x = 0; x < 16; x++) {
    const c = cols[x % 8]
    if (c) { g.fillStyle = c; g.fillRect(x, 0, 1, 8) }
  }
}, true)

/** A white grid on transparent: steel mesh for the stair railing and the cable trays. */
const meshTex = () => painted(8, 8, (g) => {
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 8, 1); g.fillRect(0, 0, 1, 8)
}, true)

/** The stair's glass wall: nothing but a few long, straight diagonal glints, in dashes. */
const streakTex = () => painted(64, 128, (g) => {
  g.fillStyle = '#ffffff'
  for (const [x0, y0, len] of [[6, 20, 70], [14, 26, 40], [40, 60, 56]]) {
    for (let i = 0; i < len; i++) if (i % 9 < 6) g.fillRect(x0 + Math.floor(i / 2), y0 + i, 1, 1)
  }
})

/** Spiral duct, painted round: across each face a bright centre band fading to dark edges, so a box
 *  reads as a silver tube; faint slanted ribs along it. The length runs along u, or along v if `upright`. */
const DUCT_PROFILE = ['#8e9498', '#a8aeb1', '#c3c8ca', '#dadddf', '#eceeef', '#f7f8f8', '#eceeef', '#d3d7d9']
const ductTex = (upright = false) => painted(upright ? 8 : 4, upright ? 4 : 8, (g) => {
  DUCT_PROFILE.forEach((c, i) => {
    g.fillStyle = c
    if (upright) g.fillRect(i, 0, 1, 4)
    else g.fillRect(0, i, 4, 1)
  })
  g.fillStyle = 'rgb(0 0 0 / 0.1)'
  for (let i = 0; i < 8; i++) {
    const rib = Math.floor(i / 2) // one texel across every two along: a slight spiral
    if (upright) g.fillRect(i, rib, 1, 1)
    else g.fillRect(rib, i, 1, 1)
  }
}, true)

/** A round ceiling diffuser seen from below: concentric grille rings in a rim, transparent outside. */
const grilleTex = () => painted(24, 24, (g) => {
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const r = Math.hypot(x - 11.5, y - 11.5)
    if (r > 11.8) continue
    g.fillStyle = r > 10.2 ? '#e1e4e5' : r < 2.5 ? '#c7cbcd' : Math.round(r / 1.5) % 2 ? '#d4d7d9' : '#7b8184'
    g.fillRect(x, y, 1, 1)
  }
})

/** Chipboard: tan, with darker and paler chips. */
export const chipboardTex = () => painted(32, 32, (g) => {
  g.fillStyle = '#c9ab7f'; g.fillRect(0, 0, 32, 32)
  const r = rng(61)
  for (let i = 0; i < 140; i++) {
    g.fillStyle = r() < 0.6 ? '#a8885c' : '#dcc39b'
    g.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 1 + Math.floor(r() * 2), 1)
  }
}, true)

const radiatorTex = () => painted(32, 8, (g) => {
  g.fillStyle = '#f3f3f0'; g.fillRect(0, 0, 32, 8)
  g.fillStyle = '#cfd0cc'
  for (let x = 1; x < 32; x += 2) g.fillRect(x, 1, 1, 6)
})

/** A pale oak door with a narrow glass light and a steel handle. */
const doorTex = () => painted(32, 64, (g) => {
  g.fillStyle = '#8f9497'; g.fillRect(0, 0, 32, 64) // the steel frame
  g.fillStyle = '#c9a777'; g.fillRect(2, 2, 28, 62)
  g.fillStyle = '#b8955f'
  for (let y = 6; y < 64; y += 7) g.fillRect(2, y, 28, 1)
  g.fillStyle = '#e6ecee'; g.fillRect(20, 8, 5, 30)
  g.fillStyle = '#5f6467'; g.fillRect(5, 32, 6, 2)
})

// ---------------------------------------------------------------------------------------------
// The room.

const BEAM = { h: 0.32, d: 0.22, pitch: 1.2 }
const DUCT = 0.36
const TUBE_DROP = 0.11 // the tubes hang this far below the beams

export function buildRoom(scene: THREE.Scene, layout: ClubLayout) {
  const { width: W, length: L, ceiling: H } = layout
  const hw = W / 2, hl = L / 2
  const beamBottom = H - BEAM.h

  // Floor, ceiling and the three plain walls (the -X wall is the windows).
  const floor = plane(W, L, mat('#ffffff', floorTex()), 2, 2)
  floor.rotation.x = -Math.PI / 2
  const ceiling = plane(W, L, mat('#ffffff', concreteTex('#8f8e88', 23), 0.56), 1.5, 1.5)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = H
  scene.add(floor, ceiling)
  const wall = wallTex()
  scene.add(at(plane(L, H, mat('#ffffff', wall, 0.93), 1, 1), hw, H / 2, 0, -Math.PI / 2))
  scene.add(at(plane(W, H, mat('#ffffff', wall, 0.84), 1, 1), 0, H / 2, -hl))
  scene.add(at(plane(W, H, mat('#ffffff', wall, 0.8), 1, 1), 0, H / 2, hl, Math.PI))
  scene.add(at(plane(1.0, 2.1, decal('#ffffff', doorTex())), layout.spawn.x, 1.05, hl - 0.01, Math.PI))

  const columnMap = columnTex()
  for (const c of layout.columns) scene.add(at(litBox(COLUMN_SIZE, H, COLUMN_SIZE, '#ffffff', columnMap, FLOOR_LIT), c.x, H / 2, c.z))

  buildCeiling(scene, layout, beamBottom)
  buildWindows(scene, layout, beamBottom)
  buildStairs(scene, layout)
  buildCollage(scene, layout)
}

/** Ribbed beams across the room, two spiral ducts along it, rows of tubes and the cable trays. */
function buildCeiling(scene: THREE.Scene, { width: W, length: L, ceiling: H, stairs }: ClubLayout, beamBottom: number) {
  const hw = W / 2, hl = L / 2
  // The stairwell (over the stairs) is kept clear: no beams, ducts, trays or tubes, so the flight
  // can rise into its opening. Anything along the room on that side stops at its edge.
  const wellZ = stairs.maxZ
  const inWell = (x0: number, x1: number, z: number) => z < wellZ && x1 > stairs.minX && x0 < hw

  const beamMap = concreteTex('#9c9b94', 31)
  const beamZ: number[] = []
  for (let z = hl - BEAM.pitch / 2; z > -hl; z -= BEAM.pitch) beamZ.push(z)
  for (const z of beamZ) {
    const w = inWell(-hw, hw, z + BEAM.d / 2) ? stairs.minX + hw : W
    scene.add(at(litBox(w, BEAM.h, BEAM.d, '#ffffff', beamMap, CEILING_LIT), -hw + w / 2, H - BEAM.h / 2, z))
  }

  // The ducts, just under the beams, each with a couple of drops: a short neck down to a round
  // diffuser. Duct faces are shaded as a silver tube in the room's light: its window side brightest,
  // its underside and room side in shadow, and a dark band on the beams above it where it shades them.
  const DUCT_LIT: Shades = [0.8, 0.8, 0.45, 0.62, 0.56, 0.8] // laid along X, then turned to run along Z
  const DROP_LIT: Shades = [0.62, 0.86, 0.5, 0.72, 0.7, 0.7]
  const duct = ductTex(), dropMap = ductTex(true)
  const grille = mat('#ffffff', grilleTex(), 0.95)
  const ductY = beamBottom - DUCT / 2 - 0.03
  for (const [x, drops] of [[-3.45, [hl - 5, -hl + 6.5]], [3.3, [hl - 3, 0.5]]] as const) {
    const end = inWell(x - DUCT / 2, x + DUCT / 2, wellZ - 0.01) ? wellZ : -hl
    const len = hl - end
    const shadow = plane(DUCT + 0.3, len, mat('#5c5d5a'), DUCT + 0.3, len, 0.6)
    shadow.rotation.x = Math.PI / 2 // facing down, just under the beams
    scene.add(at(shadow, x, beamBottom - 0.004, (hl + end) / 2))
    const run = litBox(len, DUCT, DUCT, '#ffffff', duct, DUCT_LIT)
    repeatU(run.geometry, len / 0.12)
    scene.add(at(run, x, ductY, (hl + end) / 2, Math.PI / 2))
    if (end > -hl) { // it turns up into the slab at the stairwell's edge
      scene.add(at(litBox(DUCT, H - ductY, DUCT, '#ffffff', dropMap, DROP_LIT), x, (H + ductY) / 2, end + DUCT / 2))
    }
    for (const z of drops) {
      const neck = 0.16, bottom = ductY - DUCT / 2 - neck
      scene.add(at(litBox(0.26, neck, 0.26, '#ffffff', dropMap, DROP_LIT), x, bottom + neck / 2, z))
      const disc = plane(0.46, 0.46, grille)
      disc.rotation.x = Math.PI / 2 // facing down
      scene.add(at(disc, x, bottom - 0.002, z))
    }
  }

  // Cable trays: grey steel mesh, a floor and two low sides, along the room beside the ducts.
  const mesh = meshTex()
  for (const x of [-2.75, 2.45]) {
    const end = inWell(x - 0.15, x + 0.15, wellZ - 0.01) ? wellZ : -hl
    const len = hl - end, cz = (hl + end) / 2
    const bottom = plane(0.3, len, mat('#8a8f92', mesh, 0.9), 0.1, 0.15, 0.5)
    bottom.rotation.x = Math.PI / 2
    scene.add(at(bottom, x, beamBottom - 0.07, cz))
    for (const s of [-1, 1]) {
      const side = plane(len, 0.07, mat('#8a8f92', mesh, 0.8), 0.15, 0.07, 0.5)
      scene.add(at(side, x + s * 0.15, beamBottom - 0.035, cz, s * Math.PI / 2))
      const back = plane(len, 0.07, mat('#8a8f92', mesh, 0.7), 0.15, 0.07, 0.5)
      scene.add(at(back, x + s * 0.15, beamBottom - 0.035, cz, -s * Math.PI / 2))
    }
  }

  // Thin sprinkler pipes along the room, just under the beams.
  for (const x of [-0.7, 0.9]) scene.add(at(litBox(0.05, 0.05, L, '#8e9396', null, CEILING_LIT), x, beamBottom - 0.04, 0))

  // Fluorescent tubes across the room, in every other gap between the beams: two long runs each,
  // a white glowing tube under a slim grey housing.
  const tubeY = beamBottom - TUBE_DROP
  for (let i = 0; i < beamZ.length - 1; i += 2) {
    const z = beamZ[i] - BEAM.pitch / 2
    for (const x of [-1.45, 1.35]) {
      if (inWell(x - 1.25, x + 1.25, z)) continue
      scene.add(at(litBox(2.5, 0.04, 0.1, '#8c9194', null, CEILING_LIT), x, tubeY + 0.04, z))
      scene.add(at(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 0.05, 5), glow('#ffffff')), x, tubeY, z))
    }
  }
}

/** The window wall: daylight between the columns, mullions, sheer curtains half drawn, and the
 *  bench along it with cushions, a radiator under it and a chrome pipe. */
function buildWindows(scene: THREE.Scene, layout: ClubLayout, beamBottom: number) {
  const { width: W, length: L, ceiling: H, windowBench: bench } = layout
  const hw = W / 2, hl = L / 2
  const r = rng(71)

  // The bays between the columns of the -X wall, from the door end.
  const cols = layout.columns.filter((c) => c.x < 0).map((c) => c.z).sort((a, b) => b - a)
  const bays: { z0: number; z1: number }[] = []
  let top = hl
  for (const z of cols) { bays.push({ z0: z + COLUMN_SIZE / 2, z1: top }); top = z - COLUMN_SIZE / 2 }
  bays.push({ z0: -hl, z1: top })

  const glassH = H - BENCH.h
  const daylight = glow('#ffffff', facadeTex())
  scene.add(at(plane(L, glassH, daylight, 3, glassH), -hw, BENCH.h + glassH / 2, 0, Math.PI / 2))
  scene.add(at(plane(L, BENCH.h, mat('#ffffff', wallTex(), 0.8), 1, 1), -hw + 0.003, BENCH.h / 2, 0, Math.PI / 2))

  // Frames: a sill, a transom and a head along the room; an upright in the middle of each bay.
  const frame = '#6c7276'
  for (const y of [BENCH.h + 0.03, 1.25, beamBottom - 0.02]) {
    scene.add(at(litBox(0.05, 0.05, L, frame, null, FLOOR_LIT), -hw + 0.04, y, 0))
  }
  for (const b of bays) {
    if (b.z1 - b.z0 < 1.5) continue
    scene.add(at(litBox(0.05, glassH, 0.05, frame, null, FLOOR_LIT), -hw + 0.04, BENCH.h + glassH / 2, (b.z0 + b.z1) / 2))
  }

  // Sheer curtains on a rail, drawn across part of each bay from one side or the other.
  const curtain = mat('#ffffff', curtainTex())
  const curtainTop = beamBottom - 0.06
  scene.add(at(litBox(0.03, 0.03, L, '#c9cdcf', null, CEILING_LIT), -hw + 0.12, curtainTop + 0.02, 0))
  for (const b of bays) {
    const len = b.z1 - b.z0
    const share = [1, 0.5, 0.35, 0.7, 0][Math.floor(r() * 5)]
    if (!share) continue
    const w = len * share, h = curtainTop - BENCH.h - 0.02
    const z = r() < 0.5 ? b.z0 + w / 2 : b.z1 - w / 2
    scene.add(at(plane(w, h, curtain, 0.3, h, 0.3), -hw + 0.12, BENCH.h + 0.02 + h / 2, z, Math.PI / 2))
  }

  // The bench: a chipboard top from the glass to the bench's front edge, on chipboard brackets.
  const chip = chipboardTex()
  const depth = bench.maxX + hw
  scene.add(at(litBox(depth, 0.04, L, '#ffffff', chip, FLOOR_LIT), -hw + depth / 2, BENCH.h - 0.02, 0))
  for (const c of cols) scene.add(at(litBox(bench.maxX - bench.minX, BENCH.h - 0.04, 0.04, '#ffffff', chip, FLOOR_LIT), (bench.minX + bench.maxX) / 2, (BENCH.h - 0.04) / 2, c))
  const radiator = radiatorTex()
  const pad = '#bcb19c', cushion = '#d6cbb2'
  for (const b of bays) {
    const len = b.z1 - b.z0, mid = (b.z0 + b.z1) / 2
    if (len > 1.5) scene.add(at(litBox(0.08, 0.26, len - 0.9, '#ffffff', radiator, FLOOR_LIT), -hw + 0.3, 0.24, mid))
    scene.add(at(litBox(depth - 0.12, 0.05, len - 0.1, pad, null, FLOOR_LIT), -hw + 0.06 + (depth - 0.12) / 2, BENCH.h + 0.025, mid))
    // Cushions leaning on the glass, a few to a bay.
    for (let z = b.z0 + 0.4; z < b.z1 - 0.3; z += 0.7 + r() * 0.5) {
      if (r() < 0.3) continue
      const c = at(litBox(0.15, 0.42, 0.55, cushion, null, FLOOR_LIT), -hw + 0.2, BENCH.h + 0.05 + 0.2, z + 0.25)
      c.rotation.z = 0.3
      c.rotation.y = (r() - 0.5) * 0.3
      scene.add(c)
    }
  }
  scene.add(at(litBox(0.035, 0.035, L, '#e4e8ea', null, FLOOR_LIT), bench.minX + 0.08, 0.1, 0)) // the chrome pipe
}

/** The staircase at the far end, in the +X corner: it rises from the floor to the ceiling along X,
 *  on a concrete stringer, with a steel mesh railing, behind a glass wall seen as a frame and streaks. */
function buildStairs(scene: THREE.Scene, layout: ClubLayout) {
  const { ceiling: H, stairs: s } = layout
  const x0 = s.minX + 0.1, run = s.maxX - x0
  const k = H / run // the slope
  const zFront = s.maxZ - 0.15 // the flight's room side, just behind the glass
  const flight = 1.1
  const concrete = concreteTex('#a8a7a1', 43)

  // The flight: a sheared slab under a row of steps, so it reads as one concrete mass.
  const top = H - 0.01 // everything stops under the ceiling; the flight runs on into the opening
  const slab = litBox(run, 0.25, flight, '#ffffff', concrete, FLOOR_LIT)
  slab.geometry.translate(run / 2, -0.125, 0)
  clampY(shear(slab.geometry, k), top)
  scene.add(at(slab, x0, 0, zFront - flight / 2))
  const n = Math.round(H / 0.19)
  for (let i = 0; i < n; i++) {
    const h = Math.min(H / n, top - i * H / n)
    scene.add(at(litBox(run / n, h, flight, '#ffffff', concrete, FLOOR_LIT), x0 + (i + 0.5) * run / n, i * H / n + h / 2, zFront - flight / 2))
  }

  // The opening the flight climbs into: a dark slot in the ceiling over its upper half.
  const holeX0 = x0 + run * 0.45, holeX1 = s.maxX + COLUMN_SIZE
  const hole = plane(holeX1 - holeX0, flight + 0.3, mat('#55595b', null, 1, true))
  hole.rotation.x = Math.PI / 2
  scene.add(at(hole, (holeX0 + holeX1) / 2, H - 0.005, zFront - flight / 2 + 0.1))

  // The stringer on the room side, then the mesh railing on it and a handrail on top.
  const stringer = litBox(run, 0.45, 0.12, '#ffffff', concrete, FLOOR_LIT)
  stringer.geometry.translate(run / 2, -0.12, 0)
  clampY(shear(stringer.geometry, k), top)
  scene.add(at(stringer, x0, 0, zFront + 0.06))
  const railH = 0.9
  const rail = new THREE.Mesh(new THREE.PlaneGeometry(run, railH, Math.ceil(run / 0.4), 2), mat('#e8eaeb', meshTex()))
  repeatU(rail.geometry, run / 0.1)
  const uv = rail.geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * railH / 0.1)
  rail.geometry.translate(run / 2, 0.1 + railH / 2, 0)
  clampY(shear(rail.geometry, k), top)
  scene.add(at(rail, x0, 0, zFront + 0.07))
  const handLen = Math.min(run, (top - 0.12 - railH) / k) // it ends where it would reach the ceiling
  const handrail = litBox(handLen, 0.04, 0.05, '#c9cdcf', null, FLOOR_LIT)
  handrail.geometry.translate(handLen / 2, 0.1 + railH, 0)
  shear(handrail.geometry, k)
  scene.add(at(handrail, x0, 0, zFront + 0.07))

  // The glass: frameless panes in a thin pale floor channel, a few glints, one post at the corner.
  const streaks = mat('#f2f6f7', streakTex())
  const frame = '#b4b9bc'
  const glass = (len: number, cx: number, cz: number, ry: number) => {
    const g = at(new THREE.Group(), cx, 0, cz, ry)
    g.add(at(plane(len, H, streaks, 2.4, H), 0, H / 2, 0))
    g.add(at(litBox(len, 0.04, 0.04, frame, null, FLOOR_LIT), 0, 0.02, 0))
    scene.add(g)
  }
  scene.add(at(litBox(0.035, H, 0.035, frame, null, FLOOR_LIT), s.minX, H / 2, s.maxZ))
  // Behind the flight, the glass of the next room: darker, so the stair stands out against it.
  const back = s.maxX + COLUMN_SIZE - s.minX
  scene.add(at(plane(back, H, mat('#c3cbce', streakTex(), 1, true), 1.6, H), s.minX + back / 2, H / 2, s.minZ + 0.01))
  scene.add(at(plane(back, H, mat('#7f888c', null, 1, true)), s.minX + back / 2, H / 2, s.minZ + 0.005))
  glass(s.maxX - s.minX, (s.minX + s.maxX) / 2, s.maxZ, 0)
  glass(s.maxZ - s.minZ, s.minX, (s.minZ + s.maxZ) / 2, -Math.PI / 2)
}

/** The printed photo floor: the club's covers and posters, blown up, each cropped to its rectangle. */
function buildCollage(scene: THREE.Scene, layout: ClubLayout) {
  for (const p of layout.floorCollage) {
    loadPixelTexture(textureUrl(p.imageUrl, 128)).then((tex) => {
      const geo = new THREE.PlaneGeometry(p.w, p.d, Math.ceil(p.w / 0.4), Math.ceil(p.d / 0.4))
      const img = tex.image as { width: number; height: number }
      const a = img.width / img.height, want = p.w / p.d
      const su = a > want ? want / a : 1, sv = a > want ? 1 : a / want
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (1 - su) / 2 + uv.getX(i) * su, (1 - sv) / 2 + uv.getY(i) * sv)
      const m = new THREE.Mesh(geo, decal('#ffffff', tex))
      m.rotation.x = -Math.PI / 2 // the picture's top toward the far end, upright from the door
      scene.add(at(m, p.x, 0.002, p.z))
    }, () => {}) // a missing image leaves the plain floor
  }
}
