/**
 * Theta's App API: the club's group read and written as the person who is logged in.
 *
 * The app gets its own token (`client_credentials`, scope `app`) and passes the person along as
 * `viewer` on reads and as `author` on writes, so Theta decides what each member may see and do
 * and shows their posts as theirs, "via Albumklubben.dk". What the API takes and answers is
 * written down in `docs/theta-app-api.md`.
 */
import type { BoardComment, BoardPost, Page } from '../shared/board.ts'

const timeout = () => AbortSignal.timeout(10_000)

export interface ThetaApiOptions {
  issuer: string // e.g. https://stage.theta.dk/oidc
  clientId: string
  clientSecret: string
  groupId: string
  fetch?: typeof fetch
}

/** Theta said no. `code` is Theta's own (`notFound`, `badRequest`, `userNotEligible`, …).
 *  Written out in full: the server is run by Node's strip-only mode, which has no parameter
 *  properties. */
export class ThetaError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ThetaError'
    this.status = status
    this.code = code
  }
  /** A read is refused with 404 whether the post is gone, the person left the group or they
   * never said yes to the `feed` scope. The caller cannot tell them apart, and neither can we. */
  get refused() { return this.status === 404 }
  get notEligible() { return this.code === 'userNotEligible' }
}

export type { BoardAuthor, BoardComment, BoardPost, Page } from '../shared/board.ts'

export type CardTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export interface Card {
  version: 'theta.card/v1'
  externalId: string
  title: string
  subtitle?: string
  body?: string
  badge?: { text: string; tone: CardTone }
  fields?: { label: string; value: string }[]
  actions?: { id: string; label: string; style: 'primary' | 'secondary' | 'danger'; confirm?: string; audience?: string[] }[]
  link?: { label: string; url: string }
}
export type Author = { type: 'app' } | { type: 'user'; sub: string }

interface Discovery { token_endpoint: string }

const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

/**
 * Theta's own shape for a post, read back, checked against stage on 2026-10-27.
 *
 * The text is called `text` coming out and `body` going in — the API is not symmetrical about
 * that, and a `body` read off a post is simply not there. Both are accepted here so that the post
 * Theta hands back from a write maps the same way, whichever of the two it carries.
 *
 * Theta sends no `pinned` on a post read back either; it puts the pinned ones first in the list
 * instead, so the order carries it and there is nothing to map.
 */
function toPost(raw: Record<string, any>): BoardPost {
  return {
    id: String(raw.id),
    author: { sub: String(raw.author?.sub ?? ''), name: str(raw.author?.name) ?? 'Et medlem' },
    title: str(raw.title),
    body: str(raw.text) ?? str(raw.body) ?? '',
    createdAt: str(raw.createdAt) ?? '',
    commentCount: num(raw.commentCount),
    attachmentCount: num(raw.attachmentCount),
    url: str(raw.url),
    lyttefest: null, // filled in by the board, which is the side that knows
  }
}

function toComment(raw: Record<string, any>): BoardComment {
  return {
    id: String(raw.id),
    author: { sub: String(raw.author?.sub ?? ''), name: str(raw.author?.name) ?? 'Et medlem' },
    body: str(raw.text) ?? str(raw.body) ?? '',
    createdAt: str(raw.createdAt) ?? '',
    depth: num(raw.depth),
  }
}

/** Theta pages with a cursor: `{ posts | comments, nextCursor }`. */
function page<T>(raw: Record<string, any>, map: (r: any) => T): Page<T> {
  const list = raw.posts ?? raw.comments ?? []
  return {
    items: (Array.isArray(list) ? list : []).map(map),
    nextCursor: str(raw.nextCursor),
  }
}

export function createThetaApi(opts: ThetaApiOptions) {
  const doFetch = opts.fetch ?? fetch
  const base = new URL(opts.issuer).origin
  let token: { value: string; until: number } | null = null
  let discovery: Promise<Discovery> | null = null
  const discover = () => (discovery ??= doFetch(`${opts.issuer}/.well-known/openid-configuration`, { signal: timeout() })
    .then(r => { if (!r.ok) throw new Error(`discovery ${r.status}`); return r.json() as Promise<Discovery> })
    .catch(err => { discovery = null; throw err }))

  /** The app's own token, kept until shortly before it runs out. */
  async function appToken(): Promise<string> {
    if (token && token.until > Date.now()) return token.value
    const { token_endpoint } = await discover()
    const basic = Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString('base64')
    const res = await doFetch(token_endpoint, {
      method: 'POST',
      signal: timeout(),
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'app' }).toString(),
    })
    if (!res.ok) throw new ThetaError(res.status, 'tokenFailed', 'Theta gav ikke appen et token')
    const body = await res.json() as { access_token: string; expires_in?: number }
    token = { value: body.access_token, until: Date.now() + Math.max(30, (body.expires_in ?? 300) - 60) * 1000 }
    return token.value
  }

  async function call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await doFetch(`${base}${path}`, {
      method,
      signal: timeout(),
      headers: {
        authorization: `Bearer ${await appToken()}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { /* Theta answered with something else */ }
    if (!res.ok) {
      throw new ThetaError(res.status, str(json?.error?.code) ?? 'ukendt', str(json?.error?.message) ?? `Theta svarede ${res.status}`)
    }
    return json
  }

  const q = (params: Record<string, string | number | undefined>) =>
    new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)])).toString()

  return {
    /** The group's posts as this person sees them: pinned first, then newest, says the contract. */
    async posts(viewer: string, cursor?: string, limit = 20): Promise<Page<BoardPost>> {
      return page(await call('GET', `/api/v1/app/groups/${encodeURIComponent(opts.groupId)}/posts?${q({ viewer, cursor, limit })}`), toPost)
    },
    async comments(viewer: string, postId: string, cursor?: string, limit = 50): Promise<Page<BoardComment>> {
      return page(await call('GET', `/api/v1/app/posts/${encodeURIComponent(postId)}/comments?${q({ viewer, cursor, limit })}`), toComment)
    },
    /** `externalId` is what keeps a double click or a retry from writing twice. */
    async createPost(input: { author: Author; body: string; title?: string; externalId?: string; card?: Card }): Promise<BoardPost> {
      return toPost(await call('POST', '/api/v1/app/posts', { group: opts.groupId, ...input }))
    },
    async createComment(postId: string, input: { author: Author; body: string; externalId?: string }): Promise<BoardComment> {
      return toComment(await call('POST', `/api/v1/app/posts/${encodeURIComponent(postId)}/comments`, input))
    },
    async updateCard(card: Card): Promise<void> {
      await call('PUT', `/api/v1/app/cards/${encodeURIComponent(card.externalId)}`, { card })
    },
    /** A bell notification (push only). There is no title; it is one line and a link. */
    async notify(recipients: string[], text: string, href: string): Promise<void> {
      if (recipients.length === 0) return
      await call('POST', '/api/v1/app/notifications', { recipients, text, href })
    },
  }
}

export type ThetaApi = ReturnType<typeof createThetaApi>
