import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import type { Database } from './db.ts'
import { listMeetings } from './repo.ts'
import type { Archive } from '../shared/types.ts'

const SIZES = new Set(['64', '128', '256', '512'])

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
    const cached = join(cacheDir, rel.replaceAll('/', '_') + '.png')
    if (!existsSync(cached)) {
      mkdirSync(cacheDir, { recursive: true })
      const n = Number(size)
      try {
        await sharp(src).resize(n, n, { fit: 'inside', kernel: 'nearest' }).png().toFile(cached)
      } catch {
        return reply.code(404).send({ error: 'Ikke fundet' })
      }
    }
    reply.header('Cache-Control', 'public, max-age=3600')
    return reply.type('image/png').send(createReadStream(cached))
  })
}
