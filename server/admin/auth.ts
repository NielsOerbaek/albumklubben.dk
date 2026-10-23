import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { layout } from './views.ts'

const COOKIE = 'ak_admin'
const THIRTY_DAYS = 30 * 24 * 60 * 60

function samePassword(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const loginPage = (error?: string) => layout('Log ind', `
<form method="post" action="/admin/login" class="narrow">
  <h1>Log ind</h1>
  ${error ? `<p class="error">${error}</p>` : ''}
  <label>Adgangskode <input type="password" name="password" autofocus required></label>
  <button type="submit">Log ind</button>
</form>`)

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const raw = req.cookies[COOKIE]
  const ok = raw !== undefined && req.unsignCookie(raw).valid
  if (ok) return done()
  if (req.method === 'GET') reply.redirect('/admin/login')
  else reply.code(401).send('Log ind først')
}

export function registerAuth(app: FastifyInstance, adminPassword: string) {
  app.get('/admin/login', (_req, reply) => reply.type('text/html').send(loginPage()))

  app.post<{ Body: { password?: string } }>('/admin/login', (req, reply) => {
    if (!samePassword(String(req.body?.password ?? ''), adminPassword)) {
      return reply.code(401).type('text/html').send(loginPage('Forkert adgangskode'))
    }
    reply.setCookie(COOKIE, 'ok', {
      signed: true, httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: THIRTY_DAYS,
    })
    return reply.redirect('/admin')
  })

  app.post('/admin/logout', (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' })
    return reply.redirect('/admin/login')
  })
}
