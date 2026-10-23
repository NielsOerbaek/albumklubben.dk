import * as THREE from 'three'
import { textureUrl } from '../api.ts'
import { ps1Material } from './material.ts'
import { loadPixelTexture } from './textures.ts'
import type { Album } from '../../../shared/types.ts'

// Geometry helpers. Large faces are subdivided so the affine texture warp stays small.

/** Shared PS1 materials for one fog setting, and boxes shaded with them. */
export function createBuilder(fog: { fogColor: THREE.ColorRepresentation; fogNear: number; fogFar: number }) {
  const mats = new Map<string, THREE.ShaderMaterial>()
  function mat(color: THREE.ColorRepresentation, map: THREE.Texture | null = null, shade = 1) {
    const c = new THREE.Color(color).multiplyScalar(shade)
    const key = `${c.getHexString()}|${map?.uuid ?? ''}`
    let m = mats.get(key)
    if (!m) mats.set(key, m = ps1Material({ map, color: c, ...fog }))
    return m
  }

  /** A box with flat fake lighting: lit top, dimmer fronts, darker sides. */
  function shadedBox(w: number, h: number, d: number, color: THREE.ColorRepresentation, map: THREE.Texture | null = null) {
    const seg = (n: number) => Math.max(1, Math.ceil(n / 0.5))
    const geo = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d))
    const side = mat(color, map, 0.62), front = mat(color, map, 0.8)
    return new THREE.Mesh(geo, [side, side, mat(color, map, 1), mat(color, map, 0.4), front, front])
  }

  return { mat, shadedBox }
}

/** A plane `w` × `h` whose texture repeats every `tileW` × `tileH` metres, cut every `step` metres. */
export function plane<M extends THREE.Material>(w: number, h: number, material: M, tileW = w, tileH = h, step = 0.6) {
  const geo = new THREE.PlaneGeometry(w, h, Math.ceil(w / step), Math.ceil(h / step))
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tileW, uv.getY(i) * h / tileH)
  return new THREE.Mesh(geo, material)
}

export const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0): T => {
  o.position.set(x, y, z)
  o.rotation.y = ry
  return o
}

const covers = new Map<string, Promise<THREE.Texture>>()
/** The 128 px cover texture, loaded once per album. */
export function coverTexture(album: Album): Promise<THREE.Texture> | null {
  if (!album.coverUrl) return null
  let p = covers.get(album.coverUrl)
  if (!p) covers.set(album.coverUrl, p = loadPixelTexture(textureUrl(album.coverUrl, 128)))
  return p
}
