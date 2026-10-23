import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'

export const CACHE_SIZES = ['64', '128', '256', '512']
/** File name of a derivative in .cache/<size>/ for the upload at relative path rel. */
export const cacheName = (rel: string) => rel.replaceAll('/', '_') + '.png'

const IMAGE_FORMATS: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

/** Stores an image under uploadDir/<dir>/ and returns the path relative to uploadDir. */
export async function saveImage(uploadDir: string, buf: Buffer, dir: 'covers' | 'posters'): Promise<string> {
  let format: string | undefined
  try {
    format = (await sharp(buf).metadata()).format
  } catch {
    // not an image
  }
  const ext = format && IMAGE_FORMATS[format]
  if (!ext) throw new Error('Filen er ikke et billede (jpg, png eller webp)')
  const rel = `${dir}/${randomUUID()}.${ext}`
  mkdirSync(join(uploadDir, dir), { recursive: true })
  await sharp(buf).rotate().toFile(join(uploadDir, rel))
  return rel
}

/** Streams an mp4/webm to uploadDir/videos/ and returns the path relative to uploadDir. */
export async function saveVideo(uploadDir: string, stream: Readable, filename: string): Promise<string> {
  const ext = extname(filename).toLowerCase()
  if (ext !== '.mp4' && ext !== '.webm') throw new Error('Videoen skal være mp4 eller webm')
  const rel = `videos/${randomUUID()}${ext}`
  mkdirSync(join(uploadDir, 'videos'), { recursive: true })
  try {
    await pipeline(stream, createWriteStream(join(uploadDir, rel)))
  } catch (e) {
    rmSync(join(uploadDir, rel), { force: true })
    throw e
  }
  return rel
}

export function removeFiles(uploadDir: string, paths: string[]): void {
  for (const p of paths) {
    rmSync(join(uploadDir, p), { force: true })
    for (const size of CACHE_SIZES) rmSync(join(uploadDir, '.cache', size, cacheName(p)), { force: true })
  }
}
