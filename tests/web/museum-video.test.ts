import { describe, expect, it } from 'vitest'
import type { WallItem } from '../../web/src/museum/layout.ts'
import { pickActiveVideo, volumeFor } from '../../web/src/museum/video.ts'
import type { Poster } from '../../shared/types.ts'

let nextId = 1
/** A poster hanging at (x, z) and facing along (normalX, normalZ). */
function poster(x: number, z: number, normalX: number, normalZ: number, video = true): WallItem {
  const p: Poster = { id: nextId++, meetingId: 1, position: 1, imageUrl: '/uploads/posters/p.png', caption: null, about: null,
    videoUrl: video ? '/uploads/videos/p.mp4' : null }
  return { kind: 'poster', meetingNumber: 1, poster: p, x, y: 1.6, z, normalX, normalZ, width: 0.79, height: 1.4 }
}

// The player stands at the origin. Yaw 0 looks down -Z.
const player = { x: 0, z: 0, yaw: 0 }

describe('pickActiveVideo', () => {
  it('picks the nearest poster in front', () => {
    const far = poster(0.2, -2.5, 0, 1)
    const near = poster(-0.3, -1.5, 0, 1)
    expect(pickActiveVideo(player, [far, near])).toBe(near)
    // Turned to face +X, the poster on the right-hand wall is the one in front.
    const side = poster(2, 0.3, -1, 0)
    expect(pickActiveVideo({ x: 0, z: 0, yaw: -Math.PI / 2 }, [near, side])).toBe(side)
  })

  it('ignores a poster behind the player', () => {
    expect(pickActiveVideo(player, [poster(0, 1, 0, -1)])).toBeNull()
    // Beyond 50° to the side counts as out of view too.
    expect(pickActiveVideo(player, [poster(2, -1, -1, 0)])).toBeNull()
    // Seen from behind its own wall.
    expect(pickActiveVideo(player, [poster(0, -1.5, 0, -1)])).toBeNull()
  })

  it('ignores posters without video', () => {
    const silent = poster(0, -1, 0, 1, false)
    const moving = poster(0.5, -2, 0, 1)
    expect(pickActiveVideo(player, [silent, moving])).toBe(moving)
    expect(pickActiveVideo(player, [silent])).toBeNull()
  })

  it('returns null beyond maxDist', () => {
    expect(pickActiveVideo(player, [poster(0, -3.5, 0, 1)])).toBeNull()
    expect(pickActiveVideo(player, [poster(0, -3.5, 0, 1)], 4)).not.toBeNull()
  })
})

describe('volumeFor', () => {
  it('is full up close and fades to silence at maxDist', () => {
    expect(volumeFor(0.5)).toBe(1)
    expect(volumeFor(1)).toBe(1)
    expect(volumeFor(2)).toBe(0.5)
    expect(volumeFor(3)).toBe(0)
    expect(volumeFor(5)).toBe(0)
    expect(volumeFor(3, 5)).toBe(0.5)
  })
})
