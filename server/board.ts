import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Database } from './db.ts'
import { festsByPost } from './lyttefest-repo.ts'
import { ThetaError, type BoardPost, type Page, type ThetaApi } from './theta-api.ts'
import type { BoardPage } from '../shared/board.ts'

/**
 * Opslagstavlen: the club's Theta group, read as the member who is logged in.
 *
 * Reading only. The club would rather things actually happened on Theta than in a second-rate
 * copy of it here, so the board shows what is going on and links into the group; writing a post,
 * answering one and reading a thread are all Theta's own job.
 *
 * Every read goes through Theta as that person, so nobody sees a post Theta would not show them.
 * It is therefore cached per viewer, never across people, and only for half a minute.
 */
const CACHE_MS = 30_000

interface Entry { at: number; value: unknown }

export interface BoardGroup {
  issuer: string
  groupId: string
}

export function registerBoard(app: FastifyInstance, api: ThetaApi, db: Database, group: BoardGroup) {
  // Keyed by viewer first: two members never share an answer.
  const cache = new Map<string, Entry>()
  const drop = () => cache.clear()

  /** The club's group on Theta, for "skriv på Theta" and for an empty board. */
  const groupUrl = (() => {
    try { return `${new URL(group.issuer).origin}/grupper/${encodeURIComponent(group.groupId)}` }
    catch { return null }
  })()

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit && hit.at > Date.now() - CACHE_MS) return hit.value as T
    const value = await load()
    cache.set(key, { at: Date.now(), value })
    return value
  }

  /** Theta's refusals in plain Danish. A refused read means the session is no good any more:
   * either the member never said yes to reading the group, or they are no longer in it. */
  function fail(reply: FastifyReply, err: unknown): FastifyReply {
    if (err instanceof ThetaError && err.refused) return reply.code(401).send({ error: 'Log ind igen' })
    app.log.warn({ err }, 'theta board call failed')
    return reply.code(502).send({ error: 'Opslagstavlen kan ikke hentes lige nu' })
  }

  /** Theta does not know a lyttefest from any other post; this side does. */
  function withFests(page: Page<BoardPost>): BoardPage {
    const fests = festsByPost(db, page.items.map(p => p.id))
    return {
      ...page,
      items: fests.size === 0 ? page.items : page.items.map(p => ({ ...p, lyttefest: fests.get(p.id) ?? null })),
      groupUrl,
    }
  }

  app.get<{ Querystring: { cursor?: string } }>('/api/board', async (req, reply) => {
    const { sub } = req.member!
    reply.header('Cache-Control', 'no-store')
    try {
      return withFests(await cached<Page<BoardPost>>(`${sub}|posts|${req.query.cursor ?? ''}`,
        () => api.posts(sub, req.query.cursor)))
    } catch (err) { return fail(reply, err) }
  })

  return { drop }
}
