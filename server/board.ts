import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { ThetaError, type BoardComment, type BoardPost, type Page, type ThetaApi } from './theta-api.ts'

/**
 * Opslagstavlen: the club's Theta group, read and written as the member who is logged in.
 *
 * Everything here goes through Theta as that person, so nobody sees a post Theta would not show
 * them. A read is therefore cached per viewer, never across people, and only for half a minute.
 */
const CACHE_MS = 30_000
const MAX_BODY = 5000
const MAX_TITLE = 200

interface Entry { at: number; value: unknown }

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 || t.length > max ? null : t
}

export function registerBoard(app: FastifyInstance, api: ThetaApi) {
  // Keyed by viewer first: two members never share an answer.
  const cache = new Map<string, Entry>()
  const drop = () => cache.clear()

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit && hit.at > Date.now() - CACHE_MS) return hit.value as T
    const value = await load()
    cache.set(key, { at: Date.now(), value })
    return value
  }

  /** Theta's refusals in plain Danish. A refused read means the session is no good any more:
   * either the member never said yes to reading the group, or they are no longer in it. */
  function fail(reply: FastifyReply, err: unknown, whenWriting = false): FastifyReply {
    if (err instanceof ThetaError) {
      if (err.notEligible) return reply.code(403).send({ error: 'Du kan ikke skrive i gruppen lige nu' })
      if (err.refused && !whenWriting) return reply.code(401).send({ error: 'Log ind igen' })
      if (err.refused) return reply.code(404).send({ error: 'Opslaget findes ikke længere' })
    }
    app.log.warn({ err }, 'theta board call failed')
    return reply.code(502).send({ error: whenWriting ? 'Theta tog ikke imod opslaget' : 'Opslagstavlen kan ikke hentes lige nu' })
  }

  app.get<{ Querystring: { cursor?: string } }>('/api/board', async (req, reply) => {
    const { sub } = req.member!
    reply.header('Cache-Control', 'no-store')
    try {
      return await cached<Page<BoardPost>>(`${sub}|posts|${req.query.cursor ?? ''}`, () => api.posts(sub, req.query.cursor))
    } catch (err) { return fail(reply, err) }
  })

  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>('/api/board/posts/:id/comments', async (req, reply) => {
    const { sub } = req.member!
    reply.header('Cache-Control', 'no-store')
    try {
      return await cached<Page<BoardComment>>(`${sub}|comments|${req.params.id}|${req.query.cursor ?? ''}`,
        () => api.comments(sub, req.params.id, req.query.cursor))
    } catch (err) { return fail(reply, err) }
  })

  app.post<{ Body: { title?: string; body?: string; externalId?: string } }>('/api/board/posts', async (req, reply) => {
    const { sub } = req.member!
    const body = text(req.body?.body, MAX_BODY)
    if (!body) return reply.code(400).send({ error: 'Skriv noget først' })
    const title = req.body?.title ? text(req.body.title, MAX_TITLE) ?? undefined : undefined
    try {
      const post = await api.createPost({
        author: { type: 'user', sub }, body, title,
        externalId: text(req.body?.externalId, 200) ?? randomUUID(),
      })
      // Theta sends no event for our own writes, so the next read must go to Theta.
      drop()
      return post
    } catch (err) { return fail(reply, err, true) }
  })

  app.post<{ Params: { id: string }; Body: { body?: string; externalId?: string } }>('/api/board/posts/:id/comments', async (req, reply) => {
    const { sub } = req.member!
    const body = text(req.body?.body, MAX_BODY)
    if (!body) return reply.code(400).send({ error: 'Skriv noget først' })
    try {
      const comment = await api.createComment(req.params.id, {
        author: { type: 'user', sub }, body,
        externalId: text(req.body?.externalId, 200) ?? randomUUID(),
      })
      drop()
      return comment
    } catch (err) { return fail(reply, err, true) }
  })

  return { drop }
}
