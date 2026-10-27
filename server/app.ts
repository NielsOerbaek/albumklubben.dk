import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import { registerApi } from './api.ts'
import { registerAdmin } from './admin/routes.ts'
import { registerBoard } from './board.ts'
import { createThetaApi, type ThetaApi } from './theta-api.ts'
import { registerThetaAuth, type ThetaAuthOptions } from './theta-auth.ts'
import { registerThetaWebhook } from './theta-webhook.ts'
import type { findTracklist } from './musicbrainz.ts'
import type { Database } from './db.ts'

export interface AppOptions {
  db: Database
  uploadDir: string
  adminPassword: string
  sessionSecret: string
  webDir?: string
  musicbrainz?: typeof findTracklist
  /** Members-only via Theta. index.ts refuses to start without it; tests may leave it out. */
  theta?: ThetaAuthOptions
  /** The group behind the opslagstavle. Built from `theta` unless a test passes its own. */
  thetaApi?: ThetaApi
  /** Shared with Theta, so a signed event can be told from anyone else's. No secret, no webhook. */
  thetaWebhookSecret?: string
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify()
  app.register(cookie, { secret: opts.sessionSecret })
  app.register(formbody)
  app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } })
  // First, so its gate covers every route below.
  if (opts.theta) {
    registerThetaAuth(app, opts.theta)
    const board = registerBoard(app, opts.thetaApi ?? createThetaApi(opts.theta))
    if (opts.thetaWebhookSecret) {
      registerThetaWebhook(app, { secret: opts.thetaWebhookSecret, onGroupPosted: () => board.drop() })
    }
  }
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
    app.get('/klubhuset', (_req, reply) => reply.sendFile('klubhuset.html'))
  }
  for (const old of ['crate', 'museum']) app.get(`/${old}`, (_req, reply) => reply.redirect('/klubhuset', 301))
  // Arkivet is the front page now; browsers carry a #kortet fragment across the redirect.
  app.get('/arkiv', (_req, reply) => reply.redirect('/', 301))
  return app
}
