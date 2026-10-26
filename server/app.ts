import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import { registerApi } from './api.ts'
import { registerAdmin } from './admin/routes.ts'
import type { findTracklist } from './musicbrainz.ts'
import type { Database } from './db.ts'

export interface AppOptions {
  db: Database
  uploadDir: string
  adminPassword: string
  sessionSecret: string
  webDir?: string
  musicbrainz?: typeof findTracklist
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify()
  app.register(cookie, { secret: opts.sessionSecret })
  app.register(formbody)
  app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } })
  registerApi(app, opts.db, opts.uploadDir)
  registerAdmin(app, opts)

  // dotfiles: 'ignore' keeps the derivative cache (.cache) out of reach; only real uploads are served.
  app.register(fastifyStatic, {
    root: resolve(opts.uploadDir), prefix: '/uploads/', decorateReply: false,
    dotfiles: 'ignore', cacheControl: false,
    setHeaders: (res) => res.header('Cache-Control', 'private, max-age=0, must-revalidate'),
  })

  if (opts.webDir) {
    const webDir = resolve(opts.webDir)
    app.register(fastifyStatic, { root: webDir, prefix: '/' })
    for (const page of ['klubhuset', 'arkiv']) {
      app.get(`/${page}`, (_req, reply) => reply.sendFile(`${page}.html`))
    }
  }
  for (const old of ['crate', 'museum']) app.get(`/${old}`, (_req, reply) => reply.redirect('/klubhuset', 301))
  return app
}
