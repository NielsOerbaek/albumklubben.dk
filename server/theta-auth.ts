import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/**
 * "Log ind med Theta": the whole site is for members of the club's Theta group. Theta is an
 * OIDC provider; we ask for the `groups` scope, whose claim lists the groups this app is
 * installed in where the person is an active member. A member gets a signed session cookie
 * for a day, after which the round trip (silent while their Theta session lives) checks the
 * membership again.
 */
export interface ThetaAuthOptions {
  issuer: string // e.g. https://stage.theta.dk/oidc
  clientId: string
  clientSecret: string
  groupId: string // the club's Theta group id, as the claim carries it
  publicUrl: string // this site's origin, e.g. https://albumklubben.dk
  fetch?: typeof fetch
}

const SESSION = 'ak_member'
const FLOW = 'ak_oidc'
const DAY = 24 * 60 * 60
const timeout = () => AbortSignal.timeout(10_000)
const SCOPE = 'openid profile groups feed posts'
/** The icon, the manifest and the sign-in are outside the gate: the browser, Theta (logoUrl)
 * and the login page itself must be able to fetch them without a session. */
export const ICON_FILES = [
  '/favicon.ico', '/icon.svg', '/apple-touch-icon.png',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/manifest.webmanifest',
]
const OPEN = ['/auth/', '/healthz', '/robots.txt', ...ICON_FILES]
/** A session cookie bigger than this is at risk of being dropped by the browser (the limit is
 * 4 kB), so the ID token goes out rather than the session. */
const COOKIE_LIMIT = 3500

interface Discovery {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  end_session_endpoint?: string
}
/** `idt` is the ID token, kept only so logging out can tell Theta whose session it is. */
interface Member { sub: string; name: string; exp: number; idt?: string }

const b64url = (b: Buffer) => b.toString('base64url')

/** A path on this site to come back to; anything else is the front page. Resolved the way a
 * browser will (which drops tabs and newlines, so `/\t/evil.test` is `//evil.test`). */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || /[\x00-\x1f\\]/.test(next)) return '/'
  const base = 'https://albumklubben.invalid'
  try {
    const url = new URL(next, base)
    return url.origin === base ? url.pathname + url.search + url.hash : '/'
  } catch { return '/' }
}

/** The same HEAD the built pages have, so the icon is there before anyone has logged in. */
export const iconLinks = `<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">`

/** The pages outside the gate are served by the server, not built by Vite, so they carry their
 * own copy of the look in `web/src/theme.css`: black, white and Inter Tight. */
const page = (title: string, body: string) => `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#000000">
<title>${title} · Albumklubben</title>
${iconLinks}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;600&display=swap');
*{box-sizing:border-box}
body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;
  font:300 16px/1.45 'Inter Tight',system-ui,sans-serif}
main{max-width:26rem;text-align:center}
img.mark{width:64px;height:64px;image-rendering:pixelated;margin:0 0 24px}
h1{margin:0 0 12px;font-size:28px;font-weight:300;line-height:1.1;text-transform:uppercase}
p{margin:0 0 20px;color:#9ca3af}
p.last{margin-bottom:0}
a{color:inherit}
a.button{display:inline-flex;align-items:center;height:36px;padding:0 18px;border:1px solid #fff;border-radius:999px;
  background:#fff;color:#000;font-size:13px;text-transform:uppercase;text-decoration:none}
a.button:hover{background:transparent;color:#fff}
:focus-visible{outline:2px solid #2276fc;outline-offset:2px}</style>
</head><body><main><img class="mark" src="/icon.svg" alt="" width="64" height="64">
<h1>${title}</h1>${body}</main></body></html>`

const loginButton = (next = '/') =>
  `<p class="last"><a class="button" href="/auth/login?next=${encodeURIComponent(next)}">Log ind med Theta</a></p>`

/** What a logged-out visitor gets at the address they asked for, instead of a jump to Theta. */
export const loginPage = (next: string) => page('Albumklubben',
  `<p>Klubhuset og arkivet for frokostlytteklubben på Thoravej&nbsp;29.
Kun for medlemmer af klubbens gruppe på Theta.</p>${loginButton(safeNext(next))}`)

export function registerThetaAuth(app: FastifyInstance, opts: ThetaAuthOptions) {
  const doFetch = opts.fetch ?? fetch
  const redirectUri = `${opts.publicUrl}/auth/callback`
  // The issuer is Theta's OIDC path; the front page is where someone goes to log out of Theta.
  const thetaOrigin = (() => { try { return new URL(opts.issuer).origin } catch { return 'https://theta.dk' } })()
  const cookieOpts = { signed: true, httpOnly: true, sameSite: 'lax' as const, secure: true, path: '/' }
  let discovery: Promise<Discovery> | null = null
  const discover = () => (discovery ??= doFetch(`${opts.issuer}/.well-known/openid-configuration`, { signal: timeout() })
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
    // The login page is shown at the address that was asked for, so the way back is kept.
    if (navigating) return reply.code(401).type('text/html').send(loginPage(req.url))
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
      scope: SCOPE,
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
      signal: timeout(),
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: req.query.code, redirect_uri: redirectUri, code_verifier: saved.verifier,
      }).toString(),
    })
    if (!tokenRes.ok) {
      req.log.warn({ status: tokenRes.status }, 'theta token exchange failed')
      return html(502, 'Login fejlede', `<p>Theta svarede ikke som ventet.</p>${loginButton(saved.next)}`)
    }
    const { access_token, id_token } = await tokenRes.json() as { access_token: string; id_token?: string }
    const infoRes = await doFetch(userinfo_endpoint, { headers: { authorization: `Bearer ${access_token}` }, signal: timeout() })
    if (!infoRes.ok) {
      req.log.warn({ status: infoRes.status }, 'theta userinfo failed')
      return html(502, 'Login fejlede', `<p>Theta svarede ikke som ventet.</p>${loginButton(saved.next)}`)
    }
    const info = await infoRes.json() as { sub: string; name?: string; groups?: { id: string }[] }
    if (!Array.isArray(info.groups) || !info.groups.some(g => String(g.id) === opts.groupId)) {
      return html(403, 'Kun for medlemmer',
        `<p>Albumklubben er for medlemmer af Albumklubben-gruppen på Theta. Spørg en af klubbens admins om at blive meldt ind.</p>${loginButton(saved.next)}`)
    }
    const session: Member = { sub: info.sub, name: info.name ?? '', exp: Math.floor(Date.now() / 1000) + DAY, idt: id_token }
    let value = JSON.stringify(session)
    if (encodeURIComponent(value).length > COOKIE_LIMIT) {
      // Rather lose the honest logout than have the browser drop the whole session.
      req.log.warn({ size: value.length }, 'theta id_token too big for the session cookie')
      value = JSON.stringify({ ...session, idt: undefined })
    }
    reply.setCookie(SESSION, value, { ...cookieOpts, maxAge: DAY })
    return reply.redirect(saved.next)
  })

  /**
   * Logging out ends this site's session and asks Theta to end the OIDC session for this app.
   * It does not end Theta's own login in the browser (that is a POST-only button on Theta), so
   * the logged-out page says so rather than pretending otherwise.
   */
  app.get('/auth/logout', async (req, reply) => {
    const who = member(req)
    reply.clearCookie(SESSION, { path: '/' })
    const end = who?.idt ? await discover().then(d => d.end_session_endpoint).catch(() => undefined) : undefined
    if (!end) return reply.redirect('/auth/logged-out')
    const url = new URL(end)
    url.search = new URLSearchParams({
      id_token_hint: who!.idt!,
      post_logout_redirect_uri: `${opts.publicUrl}/auth/logged-out`,
      client_id: opts.clientId,
    }).toString()
    return reply.redirect(url.toString())
  })

  app.get('/auth/logged-out', (_req, reply) => reply.type('text/html').send(page('Du er logget ud',
    `<p>Du er logget ud af Albumklubben.</p>
<p>Du er stadig logget ind på Theta i denne browser. Skal en anden logge ind, så
<a href="${thetaOrigin}">log ud på Theta</a> først.</p>${loginButton()}`)))
}
