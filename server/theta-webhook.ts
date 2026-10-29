import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Card } from './theta-api.ts'

/**
 * Theta's signed events. This is the only route outside the login gate: it is not a member who
 * calls it but Theta, and the signature is what makes it safe.
 *
 * The scheme is "Signed events" in theta-app's interop README (backend/src/modules/interop/
 * signature.ts): an HMAC-SHA256 over `<timestamp>.<raw body>` with the shared secret, sent as:
 *
 *     X-Signature: t=<unix seconds>,v1=<hex>
 *
 * `verify` below is the only place that knows the scheme, and it fails closed.
 */
const MAX_AGE_S = 5 * 60

export interface CloudEvent {
  specversion?: string
  type: string
  source?: string
  id?: string
  time?: string
  data?: Record<string, any>
}

export interface WebhookHandlers {
  secret: string
  /** Something was posted in the group: the board's cache is stale. Ids only, so just refresh. */
  onGroupPosted?: (data: Record<string, any>) => void
  /** A button on a card was pressed. Answered synchronously with the card as it now looks. */
  onCardAction?: (data: Record<string, any>) => Promise<Card | null>
}

/** True when the signature matches. Never throws, never tells the caller why not. */
export function verify(secret: string, header: string | undefined, raw: Buffer, now = Date.now()): boolean {
  if (!header || !secret) return false
  const parts = Object.fromEntries(header.split(',').map(p => p.trim().split('=', 2) as [string, string]))
  const t = Number(parts.t)
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > MAX_AGE_S) return false
  const want = parts.v1
  if (typeof want !== 'string' || want.length === 0) return false
  const mine = createHmac('sha256', secret).update(`${parts.t}.`).update(raw).digest('hex')
  const a = Buffer.from(mine, 'utf8')
  const b = Buffer.from(want, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function registerThetaWebhook(app: FastifyInstance, handlers: WebhookHandlers) {
  // In its own plugin scope, so keeping the raw body does not change how any other route is read.
  app.register(async (scope) => {
    scope.addContentTypeParser(['application/json', 'application/cloudevents+json'], { parseAs: 'buffer' },
      (req, body, done) => {
        ;(req as any).rawBody = body as Buffer
        try { done(null, JSON.parse((body as Buffer).toString('utf8'))) } catch (err) { done(err as Error) }
      })

    scope.post('/theta/webhook', async (req, reply) => {
      const raw = (req as any).rawBody as Buffer | undefined
      if (!raw || !verify(handlers.secret, req.headers['x-signature'] as string | undefined, raw)) {
        // A refusal says what arrived — the header names, and the value of anything that looks
        // like the signature — so a change of scheme on Theta's side shows up in the log. A
        // signature is a digest, not a secret, and no body is logged.
        req.log.warn({
          headers: Object.keys(req.headers),
          signature: Object.entries(req.headers)
            .filter(([k]) => k.includes('signature') || k.startsWith('theta') || k.startsWith('x-theta'))
            .map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`),
          bytes: raw?.length ?? 0,
        }, 'theta webhook refused: the signature does not match')
        return reply.code(401).send({ error: 'Underskriften passer ikke' })
      }
      const event = req.body as CloudEvent
      switch (event?.type) {
        case 'dk.theta.group.posted':
          handlers.onGroupPosted?.(event.data ?? {})
          return reply.send({ ok: true })
        case 'dk.theta.card.action': {
          const card = await handlers.onCardAction?.(event.data ?? {})
          // The answer to a card action is the card as it now looks; nothing to say is a no-op.
          if (card) return reply.send({ card })
          // Same reason as above: the field names of a card action are a guess until one is seen.
          req.log.warn({ data: Object.keys(event.data ?? {}) }, 'theta card action: no card to answer with')
          return reply.code(404).send({ error: 'Kortet findes ikke' })
        }
        default:
          // An event we do not act on is still received: Theta should not keep retrying it.
          return reply.send({ ok: true })
      }
    })
  })
}
