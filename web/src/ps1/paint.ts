import * as THREE from 'three'
import { pixelate } from './textures.ts'

/** A texture painted on a small canvas, so it stays hard-pixelled. */
export function painted(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, repeat = false) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  paint(g)
  const tex = pixelate(new THREE.CanvasTexture(c))
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** A small deterministic random, so a room looks the same on every visit. */
export function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

export function speckle(g: CanvasRenderingContext2D, w: number, h: number, alpha: number, seed: number) {
  const r = rng(seed)
  for (let i = 0; i < w * h / 6; i++) {
    g.fillStyle = r() < 0.5 ? `rgb(0 0 0 / ${alpha})` : `rgb(255 255 255 / ${alpha * 0.6})`
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1, 1)
  }
}

export async function fontsReady() {
  // Canvas text needs the web font loaded; the system font is a fine fallback.
  await Promise.race([document.fonts.load('600 40px "Inter Tight"'), new Promise((r) => setTimeout(r, 1500))])
    .catch(() => {})
}
export const FONT = '"Inter Tight", system-ui, sans-serif'

/** Sets the largest font up to `size` px at which `text` fits in `maxW`, and returns that size. */
export function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 600): number {
  do g.font = `${weight} ${size}px ${FONT}`
  while (g.measureText(text).width > maxW && --size > 6)
  return size
}
