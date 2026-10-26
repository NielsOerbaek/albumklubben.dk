import * as THREE from 'three'
import { videoTexture } from './textures.ts'

export type Player = { x: number; z: number; yaw: number }
export type Placed = { x: number; z: number; normalX: number; normalZ: number; width: number; height: number; videoUrl: string | null }

/** The nearest thing within `maxDist` (on the floor plan) whose front faces the player and that
 *  lies within `maxAngleDeg` of where the player looks. Yaw 0 looks down -Z. */
export function nearestInView<T extends Placed>(player: Player, things: T[], maxDist: number, maxAngleDeg: number): T | null {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw)
  const minCos = Math.cos(THREE.MathUtils.degToRad(maxAngleDeg))
  let best: T | null = null
  let bestDist = Infinity
  for (const t of things) {
    const dx = t.x - player.x, dz = t.z - player.z
    const dist = Math.hypot(dx, dz)
    if (dist > maxDist || dist >= bestDist) continue
    if (dx * t.normalX + dz * t.normalZ >= 0) continue // seen from behind its wall
    if (dist > 1e-6 && (dx * fx + dz * fz) / dist < minCos) continue
    best = t
    bestDist = dist
  }
  return best
}

/** The poster whose video should play: the nearest one with a video in front of the player. */
export function pickActiveVideo<T extends Placed>(player: Player, items: T[], maxDist = 3, maxAngleDeg = 50): T | null {
  return nearestInView(player, items.filter((i) => i.videoUrl), maxDist, maxAngleDeg)
}

/** Full volume at 1 m or closer, fading linearly to silence at `maxDist`. */
export function volumeFor(dist: number, maxDist = 3): number {
  return THREE.MathUtils.clamp((maxDist - dist) / Math.max(maxDist - 1, 1e-6), 0, 1)
}

/** A poster with a video, as hung in the scene: its picture and the image it shows when still. */
export interface VideoPoster<T extends Placed = Placed> {
  item: T
  picture: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  image: THREE.Texture
  /** The picture's width / height at scale 1: the still image's own shape, fitted inside the item. */
  aspect: number
  /** A black card behind the picture, shown while a video of another shape plays. */
  backing: THREE.Object3D
}

/** Plays at most one poster video at a time. Call `update` every frame, with `null` while the
 *  player is not walking (pointer unlocked, tab hidden) to pause everything. */
export function createVideoWall<T extends Placed>(posters: VideoPoster<T>[]) {
  const byItem = new Map(posters.map((p) => [p.item, p]))
  const items = posters.map((p) => p.item)
  const videos = new Map<VideoPoster<T>, { video: HTMLVideoElement; texture: THREE.VideoTexture }>()
  let active: VideoPoster<T> | null = null

  /** Puts the video on the poster, fitted inside its frame, once it has a frame to show. */
  function show(p: VideoPoster<T>) {
    const { video, texture } = videos.get(p)!
    if (active !== p || video.readyState < 2) return
    const va = video.videoWidth / video.videoHeight || 1
    const pa = p.aspect
    p.picture.scale.set(Math.min(1, va / pa), Math.min(1, pa / va), 1)
    p.picture.material.uniforms.map.value = texture
    p.backing.visible = true
  }

  function still(p: VideoPoster<T>) {
    p.picture.scale.set(1, 1, 1)
    p.picture.material.uniforms.map.value = p.image
    p.backing.visible = false
  }

  function videoFor(p: VideoPoster<T>) {
    let v = videos.get(p)
    if (!v) {
      const video = document.createElement('video')
      video.playsInline = true
      video.preload = 'metadata'
      video.loop = true
      video.muted = false
      video.src = p.item.videoUrl!
      video.addEventListener('loadeddata', () => show(p))
      videos.set(p, v = { video, texture: videoTexture(video) })
    }
    return v.video
  }

  return {
    update(player: Player | null) {
      const item = player && pickActiveVideo(player, items)
      const next = item ? byItem.get(item)! : null
      if (next !== active) {
        if (active) still(active)
        active = next
      }
      for (const [p, { video }] of videos) if (p !== active && !video.paused) video.pause()
      if (!active || !player) return
      const video = videoFor(active)
      video.volume = volumeFor(Math.hypot(active.item.x - player.x, active.item.z - player.z))
      // Entering pointer lock was a click, so sound may start; a refusal is left quiet.
      if (video.paused) video.play().catch(() => {})
      show(active)
    },
  }
}
