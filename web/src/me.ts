import type { Face } from './face.ts'

/**
 * Who is logged in, for the top bar. The session is an httpOnly cookie, so the page cannot read
 * it and has to ask; `/api/me` is behind the same gate as everything else, which is why a page
 * that renders at all has someone to name.
 *
 * It is fetched once per page and kept here rather than passed down, because the top bar is one
 * per page and every page draws it the same way. A page that wants the face in it asks for it
 * when it starts and draws again when the answer comes; until then the bar is simply the way it
 * has always been.
 */
export interface Me extends Face {
  /** The club's group on Theta, which the bar links to. Null if the server could not say. */
  groupUrl: string | null
}

let me: Me | null = null

/** The member, once `loadMe` has answered. Null before that, and if the ask failed. */
export const currentMe = (): Me | null => me

/** Asks once, then calls back so the page can draw the bar again with a face in it. */
export async function loadMe(drawn: () => void): Promise<void> {
  if (me) return drawn()
  try {
    const res = await fetch('/api/me', { headers: { accept: 'application/json' } })
    if (!res.ok) return
    const who = await res.json() as Me
    if (typeof who?.sub !== 'string' || typeof who?.name !== 'string') return
    me = { ...who, groupUrl: typeof who.groupUrl === 'string' ? who.groupUrl : null }
  } catch { return } // Offline, or the session has gone: the bar does without a name.
  drawn()
}
