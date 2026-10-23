import { createReadStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import type { Database } from './db.ts'
import { CACHE_SIZES, cacheName } from './files.ts'
import { listMeetings } from './repo.ts'
import type { Archive } from '../shared/types.ts'

const SIZES = new Set(CACHE_SIZES)

export function registerApi(app: FastifyInstance, db: Database, uploadDir: string) {
  app.get('/api/archive', async (_req, reply): Promise<Archive> => {
    reply.header('Cache-Control', 'no-store')
    return { meetings: listMeetings(db) }
  })

  app.get<{ Params: { size: string; '*': string } }>('/tex/:size/*', async (req, reply) => {
    const { size, '*': rel } = req.params
    if (!SIZES.has(size)) return reply.code(400).send({ error: 'Ugyldig størrelse' })
    const root = resolve(uploadDir)
    const src = resolve(root, rel)
    const inside = src.startsWith(root + sep) && !rel.split('/').some(s => s.startsWith('.'))
    if (!inside || !existsSync(src)) return reply.code(404).send({ error: 'Ikke fundet' })
    const cacheDir = join(root, '.cache', size)
    const cached = join(cacheDir, cacheName(rel))
    if (!existsSync(cached)) {
      mkdirSync(cacheDir, { recursive: true })
      const n = Number(size)
      try {
        const tmp = `${cached}.${randomUUID()}.tmp`
        await sharp(src).resize(n, n, { fit: 'inside', kernel: 'nearest' }).png().toFile(tmp)
        renameSync(tmp, cached)
      } catch {
        return reply.code(404).send({ error: 'Ikke fundet' })
      }
    }
    reply.header('Cache-Control', 'private, max-age=3600')
    return reply.type('image/png').send(createReadStream(cached))
  })
}
