import type { BoardPage, BoardPost } from '../../../shared/board.ts'

/**
 * Opslagstavlen: what is going on in the club's Theta group.
 *
 * This is only the reading of it. What it looks like is `klubhus/boardmenu.ts`, because the board
 * is a thing in the room now — the cork board on the wall by the door — and not a dialog over
 * every page of the site. Reading only, either way: a post opens on Theta, where it is answered
 * and where the thread is.
 */
export class BoardError extends Error {
  readonly needsLogin: boolean
  constructor(message: string, needsLogin = false) {
    super(message)
    this.needsLogin = needsLogin
  }
}

async function ask<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } })
  } catch {
    throw new BoardError('Opslagstavlen kan ikke hentes lige nu')
  }
  if (res.status === 401) throw new BoardError('Log ind igen for at se opslagstavlen', true)
  const body = await res.json().catch(() => null) as { error?: string } | null
  if (!res.ok) throw new BoardError(body?.error ?? 'Noget gik galt')
  return body as T
}

export const boardApi = {
  posts: (cursor?: string) => ask<BoardPage>(`/api/board${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
}

/** Everything the board knows at a given moment. The view draws this and nothing else. */
export interface BoardState {
  posts: BoardPost[]
  /** Set while there are older posts to be had. */
  cursor: string | null
  /** The group itself on Theta, which is the way in to writing. */
  groupUrl: string | null
  busy: boolean
  error: BoardError | null
}

export interface Board {
  state(): BoardState
  /** Reads the newest posts, forgetting what was read before. */
  load(): Promise<void>
  /** Reads the page after the one in hand. Does nothing when there is none. */
  more(): Promise<void>
  /** The newest posts for the cork board in the room; `'error'` instead of throwing. */
  peek(): Promise<BoardPost[] | 'error'>
}

export function createBoard(onChange: () => void = () => {}): Board {
  const state: BoardState = { posts: [], cursor: null, groupUrl: null, busy: false, error: null }

  async function read(again: boolean) {
    if (state.busy) return
    state.busy = true
    state.error = null
    onChange()
    try {
      const page = await boardApi.posts(again ? undefined : state.cursor ?? undefined)
      state.posts = again ? page.items : [...state.posts, ...page.items]
      state.cursor = page.nextCursor
      state.groupUrl = page.groupUrl
    } catch (err) {
      state.error = err instanceof BoardError ? err : new BoardError('Opslagstavlen kan ikke hentes lige nu')
    }
    state.busy = false
    onChange()
  }

  return {
    state: () => state,
    load: () => read(true),
    more: () => (state.cursor ? read(false) : Promise.resolve()),
    async peek() {
      try {
        const page = await boardApi.posts()
        state.posts = page.items
        state.cursor = page.nextCursor
        state.groupUrl = page.groupUrl
        onChange()
        return page.items
      } catch { return 'error' as const }
    },
  }
}
