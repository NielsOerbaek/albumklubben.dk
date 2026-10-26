import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app.ts'
import { openDb } from '../../server/db.ts'
import { saveImage, saveVideo } from '../../server/files.ts'
import { seed } from '../../server/seed.ts'
import type { Archive } from '../../shared/types.ts'

const setup = () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'api-'))
  const db = openDb(':memory:')
  seed(db, 'data', uploadDir)
  const app = buildApp({ db, uploadDir, adminPassword: 'x', sessionSecret: 'y' })
  return { app, uploadDir }
}
const firstCover = async (app: ReturnType<typeof setup>['app']) => {
  const archive = (await app.inject('/api/archive')).json() as Archive
  return archive.meetings.flatMap(m => m.albums).find(a => a.coverUrl)!.coverUrl!
}

describe('pages', () => {
  it('301s /crate and /museum to /klubhuset', async () => {
    const { app } = setup()
    for (const old of ['/crate', '/museum']) {
      const res = await app.inject(old)
      expect(res.statusCode).toBe(301)
      expect(res.headers.location).toBe('/klubhuset')
    }
  })

  it('301s /arkiv to the front page', async () => {
    const res = await setup().app.inject('/arkiv')
    expect(res.statusCode).toBe(301)
    expect(res.headers.location).toBe('/')
  })

  it('serves klubhuset.html at /klubhuset', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'web-'))
    writeFileSync(join(webDir, 'klubhuset.html'), '<p>klubhuset</p>')
    const uploadDir = mkdtempSync(join(tmpdir(), 'api-'))
    const app = buildApp({ db: openDb(':memory:'), uploadDir, adminPassword: 'x', sessionSecret: 'y', webDir })
    const res = await app.inject('/klubhuset')
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('<p>klubhuset</p>')
  })
})

describe('api', () => {
  it('GET /api/archive returns seeded meetings in number order', async () => {
    const res = await setup().app.inject('/api/archive')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const numbers = (res.json() as Archive).meetings.map(m => m.number)
    expect(numbers).toHaveLength(22)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })

  it('serves an uploaded cover', async () => {
    const { app } = setup()
    const res = await app.inject(await firstCover(app))
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^image\//)
    expect(res.headers['cache-control']).toMatch(/^private/)
  })

  it('/uploads/../.env is 404', async () => {
    const { app } = setup()
    expect((await app.inject('/uploads/../.env')).statusCode).toBe(404)
    expect((await app.inject('/uploads/%2e%2e/.env')).statusCode).toBe(404)
  })

  it('/tex/128/<cover> returns a PNG at most 128 px wide', async () => {
    const { app } = setup()
    const url = (await firstCover(app)).replace('/uploads/', '/tex/128/')
    const res = await app.inject(url)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    const meta = await sharp(res.rawPayload).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBeLessThanOrEqual(128)
    expect(res.headers['cache-control']).toBe('private, max-age=3600')
    expect((await app.inject(url)).statusCode).toBe(200) // from cache
  })

  it('/thumb/512/<cover> is a smooth PNG at most 512 px, apart from the /tex copy', async () => {
    const { app } = setup()
    const cover = await firstCover(app)
    const res = await app.inject(cover.replace('/uploads/', '/thumb/512/'))
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect((await sharp(res.rawPayload).metadata()).width).toBeLessThanOrEqual(512)
    const tex = await app.inject(cover.replace('/uploads/', '/tex/512/'))
    expect(Buffer.compare(res.rawPayload, tex.rawPayload)).not.toBe(0)
    expect((await app.inject('/thumb/100/covers/x.png')).statusCode).toBe(400)
    expect((await app.inject('/thumb/128/%2e%2e/%2e%2e/package.json')).statusCode).toBe(404)
  })

  it('/tex/100/... is 400, traversal is 404', async () => {
    const { app } = setup()
    const path = (await firstCover(app)).replace('/uploads/', '')
    expect((await app.inject(`/tex/100/${path}`)).statusCode).toBe(400)
    expect((await app.inject('/tex/128/%2e%2e/%2e%2e/package.json')).statusCode).toBe(404)
    expect((await app.inject('/tex/128/covers/nope.png')).statusCode).toBe(404)
  })
})

describe('files', () => {
  it('saveImage rejects a text file named .jpg', async () => {
    const { uploadDir } = setup()
    await expect(saveImage(uploadDir, Buffer.from('hello'), 'covers'))
      .rejects.toThrow('Filen er ikke et billede (jpg, png eller webp)')
  })

  it('saveImage stores a real image with the detected extension', async () => {
    const { uploadDir } = setup()
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer()
    expect(await saveImage(uploadDir, png, 'posters')).toMatch(/^posters\/[0-9a-f-]{36}\.png$/)
  })

  it('saveVideo rejects .mov', async () => {
    const { uploadDir } = setup()
    await expect(saveVideo(uploadDir, Readable.from(['x']), 'clip.MOV'))
      .rejects.toThrow('Videoen skal være mp4 eller webm')
  })

  it('saveVideo stores .MP4', async () => {
    const { uploadDir } = setup()
    expect(await saveVideo(uploadDir, Readable.from(['x']), 'clip.MP4')).toMatch(/^videos\/[0-9a-f-]{36}\.mp4$/)
  })
})
