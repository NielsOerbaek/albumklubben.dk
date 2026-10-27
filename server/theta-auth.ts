import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/**
 * "Log ind med Theta": the whole site is for members of the club's Theta group. Theta is an
 * OIDC provider; we ask for the `groups` scope, whose claim lists the groups this app is
 * installed in where the person is an active member. A member gets a signed session cookie
 * for a week, after which the round trip (silent while their Theta session lives) checks the
 * membership again.
 */
export interface ThetaAuthOptions {
  issuer: string // e.g. https://stage.theta.dk/oidc
  clientId: string
  clientSecret: string
  groupId: string // the club's Theta group id, as the claim carries it
  publicUrl: string // this site's origin, e.g. https://albumklubben.dn.osogdata.dk
  fetch?: typeof fetch
}

const SESSION = 'ak_member'
const FLOW = 'ak_oidc'
const WEEK = 7 * 24 * 60 * 60
const OPEN = ['/auth/', '/healthz', '/robots.txt']

interface Discovery { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string }
interface Member { sub: string; name: string; exp: number }

const b64url = (b: Buffer) => b.toString('base64url')

/** A path on this site to come back to; anything else is the front page. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next : '/'
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · Albumklubben</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}
main{max-width:26rem}h1{font-size:1.4rem}a.button{display:inline-block;background:#eee;color:#111;padding:.6rem 1rem;border-radius:6px;text-decoration:none;font-weight:600}</style>
</head><body><main><h1>${title}</h1>${body}</main></body></html>`

const loginButton = (next = '/') =>
  `<p><a class="button" href="/auth/login?next=${encodeURIComponent(next)}">Log ind med Theta</a></p>`

export function registerThetaAuth(app: FastifyInstance, opts: ThetaAuthOptions) {
  const doFetch = opts.fetch ?? fetch
  const redirectUri = `${opts.publicUrl}/auth/callback`
  const cookieOpts = { signed: true, httpOnly: true, sameSite: 'lax' as const, secure: true, path: '/' }
  let discovery: Promise<Discovery> | null = null
  const discover = () => (discovery ??= doFetch(`${opts.issuer}/.well-known/openid-configuration`)
    .then(r => { if (!r.ok) throw new Error(`discovery ${r.status}`); return r.json() as Promise<Discovery> })
    .catch(err => { discovery = null; throw err }))

  const member = (req: FastifyRequest): Member | null => {
    const raw = req.cookies[SESSION]
    if (raw === undefined) return null
    const { valid, value } = req.unsignCookie(raw)
    if (!valid || value === null) return null
    try {
      const m = JSON.parse(value) as Member
      return typeof m.exp === 'number' && m.exp > Date.now() / 1000 ? m : null
    } catch { return null }
  }

  // Everything but the sign-in itself is for members. Registered before any route.
  app.addHook('onRequest', (req, reply, done) => {
    const path = req.url.split('?')[0]
    if (OPEN.some(p => path === p || (p.endsWith('/') && path.startsWith(p)))) return done()
    if (member(req)) return done()
    const navigating = req.method === 'GET' &&
      (req.headers['sec-fetch-mode'] === 'navigate' || (req.headers.accept ?? '').includes('text/html'))
    if (navigating) return reply.redirect(`/auth/login?next=${encodeURIComponent(req.url)}`)
    reply.code(401).send('Log ind med Theta først')
  })

  app.get('/healthz', (_req, reply) => reply.send('ok'))

  app.get<{ Querystring: { next?: string } }>('/auth/login', async (req, reply) => {
    const { authorization_endpoint } = await discover()
    const state = b64url(randomBytes(24))
    const verifier = b64url(randomBytes(32))
    reply.setCookie(FLOW, JSON.stringify({ state, verifier, next: safeNext(req.query.next) }), { ...cookieOpts, maxAge: 600 })
    const url = new URL(authorization_endpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: opts.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile groups',
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString()
    return reply.redirect(url.toString())
  })

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/callback', async (req, reply) => {
    const raw = req.cookies[FLOW]
    const flow = raw === undefined ? null : req.unsignCookie(raw)
    reply.clearCookie(FLOW, { path: '/' })
    let saved: { state: string; verifier: string; next: string } | null = null
    try { saved = flow?.valid && flow.value ? JSON.parse(flow.value) : null } catch { saved = null }
    const html = (code: number, title: string, body: string) => reply.code(code).type('text/html').send(page(title, body))

    if (!saved || !req.query.state || req.query.state !== saved.state) {
      return html(400, 'Login udløbet', `<p>Prøv igen.</p>${loginButton()}`)
    }
    if (req.query.error || !req.query.code) {
      return html(403, 'Ikke logget ind', `<p>Theta gav ikke adgang.</p>${loginButton(saved.next)}`)
    }

    const { token_endpoint, userinfo_endpoint } = await discover()
    const basic = Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString('base64')
    const tokenRes = await doFetch(token_endpoint, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: req.query.code, redirect_uri: redirectUri, code_verifier: saved.verifier,
      }).toString(),
    })
    if (!tokenRes.ok) {
      req.log.warn({ status: tokenRes.status }, 'theta token exchange failed')
      return html(502, 'Login fejlede', `<p>Theta svarede ikke som ventet.</p>${loginButton(saved.next)}`)
    }
    const { access_token } = await tokenRes.json() as { access_token: string }
    const infoRes = await doFetch(userinfo_endpoint, { headers: { authorization: `Bearer ${access_token}` } })
    if (!infoRes.ok) {
      req.log.warn({ status: infoRes.status }, 'theta userinfo failed')
      return html(502, 'Login fejlede', `<p>Theta svarede ikke som ventet.</p>${loginButton(saved.next)}`)
    }
    const info = await infoRes.json() as { sub: string; name?: string; groups?: { id: string }[] }
    if (!Array.isArray(info.groups) || !info.groups.some(g => String(g.id) === opts.groupId)) {
      return html(403, 'Kun for medlemmer',
        `<p>Albumklubben er for medlemmer af Albumklubben-gruppen på Theta. Spørg en af klubbens admins om at blive meldt ind.</p>${loginButton(saved.next)}`)
    }
    const session: Member = { sub: info.sub, name: info.name ?? '', exp: Math.floor(Date.now() / 1000) + WEEK }
    reply.setCookie(SESSION, JSON.stringify(session), { ...cookieOpts, maxAge: WEEK })
    return reply.redirect(saved.next)
  })

  app.get('/auth/logout', (_req, reply) => {
    reply.clearCookie(SESSION, { path: '/' })
    return reply.type('text/html').send(page('Du er logget ud', `<p>Du er logget ud af Albumklubben.</p>${loginButton()}`))
  })
}
