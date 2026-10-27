import { html, nothing, type TemplateResult } from 'lit-html'
import { formatPostTime, type BoardPage, type BoardPost } from '../../../shared/board.ts'
import './board.css'

/**
 * Opslagstavlen: what is going on in the club's Theta group, and the way in to it. The same
 * dialog opens from the cork board in Klubhuset and from the top bar, because the room is not
 * for every device.
 *
 * Reading only. A post opens on Theta, where it is answered and where the thread is — the club
 * would rather things happened there than in a copy of Theta built into this site. Whatever text
 * is shown here is put on the page as text, never as HTML, whoever wrote it.
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

/** Plain text as text, with its line breaks kept. */
const lines = (text: string) => text.split('\n').map((line, i) =>
  html`${i > 0 ? html`<br>` : nothing}${line}`)

const loginNote = html`<p class="board-note">Din adgang til gruppen skal fornys.
  <a class="pill" href="/auth/logout">Log ind igen</a></p>`

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface BoardOptions {
  /** Puts the dialog on the page (or takes it off again with `null`). */
  show(content: TemplateResult | null): void
  /** Called when the dialog closes, so the room can take the controls back. */
  onClose?(): void
}

export interface Board {
  open(): void
  close(): void
  isOpen(): boolean
  /** The newest posts for the cork board in the room; `'error'` instead of throwing. */
  peek(): Promise<BoardPost[] | 'error'>
  /** Fetches again if the dialog is open. */
  refresh(): void
}

export function createBoard(opts: BoardOptions): Board {
  let open = false
  let posts: BoardPost[] = []
  let cursor: string | null = null
  let groupUrl: string | null = null
  let busy = false
  let error: BoardError | null = null

  async function load(again = false) {
    busy = true
    error = null
    draw()
    try {
      const page = await boardApi.posts(again ? undefined : cursor ?? undefined)
      posts = again ? page.items : [...posts, ...page.items]
      cursor = page.nextCursor
      groupUrl = page.groupUrl
    } catch (err) {
      error = err instanceof BoardError ? err : new BoardError('Opslagstavlen kan ikke hentes lige nu')
    }
    busy = false
    draw()
  }

  const close = () => {
    open = false
    opts.show(null)
    opts.onClose?.()
  }

  const errorNote = () => error
    ? html`<p class="board-error">${error.message}</p>${error.needsLogin ? loginNote : nothing}`
    : nothing

  /** A post as a note on the board: what fits of it, and the way in to Theta. */
  function postTemplate(post: BoardPost): TemplateResult {
    return html`<li>
      <a class="board-post" href=${post.url ?? '#'} target="_blank" rel="noreferrer">
        <p class="board-by">
          ${post.lyttefest ? html`<span class="board-tag">Lyttefest</span>` : nothing}
          <strong>${post.author.name}</strong>
          <span class="board-when">${formatPostTime(post.createdAt)}</span>
        </p>
        ${post.title ? html`<h3>${post.title}</h3>` : nothing}
        ${post.body ? html`<p class="board-body">${lines(post.body)}</p>` : nothing}
        <p class="board-meta">
          ${post.commentCount > 0 ? html`<span>${count(post.commentCount, 'kommentar', 'kommentarer')}</span>` : nothing}
          ${post.attachmentCount > 0 ? html`<span>${count(post.attachmentCount, 'fil', 'filer')}</span>` : nothing}
          <span class="board-go">Åbn på Theta →</span>
        </p>
      </a>
    </li>`
  }

  function template(): TemplateResult {
    return html`<div class="board-dialog" @click=${(e: MouseEvent) => {
      if (e.target === e.currentTarget && e.detail < 2) close()
    }}>
      <div class="board-inner" role="dialog" aria-label="Opslagstavlen">
        <button class="board-close" aria-label="Luk" @click=${close}>×</button>
        <div class="board-head">
          <h2>Opslagstavlen</h2>
          ${groupUrl ? html`<a class="pill" href=${groupUrl} target="_blank" rel="noreferrer">Skriv på Theta</a>` : nothing}
        </div>
        ${errorNote()}
        ${posts.length === 0 && !busy && !error
          ? html`<p class="board-empty">Der er ikke skrevet noget i gruppen endnu.</p>`
          : nothing}
        <ol class="board-list">${posts.map(postTemplate)}</ol>
        ${busy ? html`<p class="board-note">Henter …</p>` : nothing}
        ${cursor && !busy ? html`<button class="pill" @click=${() => load()}>Vis flere</button>` : nothing}
        <p class="board-note">Opslag skrives, besvares og læses på Theta. Her hænger de bare.</p>
      </div>
    </div>`
  }

  const draw = () => { if (open) opts.show(template()) }

  return {
    open() {
      open = true
      draw()
      // Always a fresh read when it opens; the server holds each member's own for half a minute.
      void load(true)
    },
    close,
    isOpen: () => open,
    async peek() {
      try {
        const page = await boardApi.posts()
        posts = page.items
        cursor = page.nextCursor
        groupUrl = page.groupUrl
        return page.items
      } catch { return 'error' as const }
    },
    refresh() { if (open && !busy) void load(true) },
  }
}
