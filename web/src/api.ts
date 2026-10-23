import type { Archive } from '../../shared/types.ts'

export async function fetchArchive(): Promise<Archive> {
  const res = await fetch('/api/archive')
  if (!res.ok) throw new Error(`Arkivet kunne ikke hentes (${res.status})`)
  return res.json()
}

/** Maps `/uploads/x` to the pixelated `/tex/<size>/x`. */
export function textureUrl(url: string, size: 64 | 128 | 256 | 512): string {
  return url.replace(/^\/uploads\//, `/tex/${size}/`)
}
