import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import { registerApi } from './api.ts'
import type { Database } from './db.ts'

export interface AppOptions {
  db: Database
  uploadDir: string
  adminPassword: string
  sessionSecret: string
  webDir?: string
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify()
  app.register(cookie, { secret: opts.sessionSecret })
  registerApi(app, opts.db, opts.uploadDir)

  // Dotfiles (.cache) are ignored by default, so only real uploads are served.
  app.register(fastifyStatic, {
    root: resolve(opts.uploadDir), prefix: '/uploads/', decorateReply: false,
  })

  if (opts.webDir) {
    const webDir = resolve(opts.webDir)
    app.register(fastifyStatic, { root: webDir, prefix: '/' })
    for (const page of ['crate', 'museum', 'arkiv']) {
      app.get(`/${page}`, (_req, reply) => reply.sendFile(`${page}.html`))
    }
  }
  return app
}
