import { html, nothing, type TemplateResult } from 'lit-html'
import { formatPostTime, type BoardComment, type BoardPost, type Page } from '../../../shared/board.ts'
import './board.css'

/**
 * Opslagstavlen: the club's Theta group, read and written here. The same dialog opens from the
 * cork board in Klubhuset and from the top bar, because the room is not for every device.
 *
 * Everything shown is plain text, put on the page as text. Theta's content is never rendered as
 * HTML, whoever wrote it.
 */
const PAGE_TEXT = 'Vis flere'

export class BoardError extends Error {
  constructor(message: string, readonly needsLogin = false) { super(message) }
}

async function ask<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, ...init })
  } catch {
    throw new BoardError('Opslagstavlen kan ikke hentes lige nu')
  }
  if (res.status === 401) throw new BoardError('Log ind igen for at se opslagstavlen', true)
  const body = await res.json().catch(() => null) as { error?: string } | null
  if (!res.ok) throw new BoardError(body?.error ?? 'Noget gik galt')
  return body as T
}

export const boardApi = {
  posts: (cursor?: string) => ask<Page<BoardPost>>(`/api/board${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  comments: (id: string, cursor?: string) =>
    ask<Page<BoardComment>>(`/api/board/posts/${encodeURIComponent(id)}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  write: (body: { body: string; title?: string; externalId: string }) =>
    ask<BoardPost>('/api/board/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  comment: (id: string, body: { body: string; externalId: string }) =>
    ask<BoardComment>(`/api/board/posts/${encodeURIComponent(id)}/comments`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
}

/** Plain text as text, with its line breaks kept. */
const lines = (text: string) => text.split('\n').map((line, i) =>
  html`${i > 0 ? html`<br>` : nothing}${line}`)

const loginNote = html`<p class="board-note">Din adgang til gruppen skal fornys.
  <a class="pill" href="/auth/logout">Log ind igen</a></p>`

type View =
  | { at: 'list' }
  | { at: 'post'; post: BoardPost }
  | { at: 'write' }

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
  /** Fetches again if the dialog is open and showing the list. */
  refresh(): void
}

export function createBoard(opts: BoardOptions): Board {
  let view: View = { at: 'list' }
  let open = false
  let posts: BoardPost[] = []
  let cursor: string | null = null
  let comments: BoardComment[] = []
  let commentCursor: string | null = null
  let busy = false
  let error: BoardError | null = null
  let sending = false
  let sent: string | null = null
  // Made when a form opens, so a double click or a retry writes once.
  let formId = ''
  let draft = { title: '', body: '' }

  const uuid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)

  async function load(again = false) {
    busy = true
    error = null
    draw()
    try {
      const page = await boardApi.posts(again ? undefined : cursor ?? undefined)
      posts = again ? page.items : [...posts, ...page.items]
      cursor = page.nextCursor
    } catch (err) {
      error = err instanceof BoardError ? err : new BoardError('Opslagstavlen kan ikke hentes lige nu')
    }
    busy = false
    draw()
  }

  async function loadComments(post: BoardPost, more = false) {
    busy = true
    error = null
    draw()
    try {
      const page = await boardApi.comments(post.id, more ? commentCursor ?? undefined : undefined)
      comments = more ? [...comments, ...page.items] : page.items
      commentCursor = page.nextCursor
    } catch (err) {
      error = err instanceof BoardError ? err : new BoardError('Kommentarerne kan ikke hentes lige nu')
    }
    busy = false
    draw()
  }

  function openPost(post: BoardPost) {
    view = { at: 'post', post }
    comments = []
    commentCursor = null
    sent = null
    formId = uuid()
    draft = { title: '', body: '' }
    void loadComments(post)
  }

  function toList() {
    view = { at: 'list' }
    error = null
    sent = null
    draw()
  }

  async function send() {
    const body = draft.body.trim()
    if (!body || sending) return
    sending = true
    error = null
    draw()
    try {
      if (view.at === 'write') {
        const made = await boardApi.write({ body, title: draft.title.trim() || undefined, externalId: formId })
        draft = { title: '', body: '' }
        formId = uuid()
        view = { at: 'list' }
        await load(true)
        // A group may hold a post for a moderator, and Theta still answers that it took it.
        sent = posts.some(p => p.id === made.id) ? null : 'Sendt. Det vises, når det er godkendt.'
      } else if (view.at === 'post') {
        const made = await boardApi.comment(view.post.id, { body, externalId: formId })
        draft = { title: '', body: '' }
        formId = uuid()
        await loadComments(view.post)
        sent = comments.some(c => c.id === made.id) ? null : 'Sendt. Den vises, når den er godkendt.'
      }
    } catch (err) {
      error = err instanceof BoardError ? err : new BoardError('Theta tog ikke imod opslaget')
    }
    sending = false
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

  const postHead = (post: BoardPost) => html`
    <p class="board-by">
      ${post.pinned ? html`<span class="board-pin" title="Hæftet øverst">📌</span>` : nothing}
      <strong>${post.author.name}</strong>
      <span class="board-when">${formatPostTime(post.createdAt)}</span>
    </p>`

  const attachments = (post: BoardPost) => post.attachmentCount > 0 && post.url
    ? html`<a class="board-link" href=${post.url} target="_blank" rel="noreferrer">
        ${post.attachmentCount} ${post.attachmentCount === 1 ? 'fil' : 'filer'} på Theta</a>`
    : nothing

  function listTemplate(): TemplateResult {
    return html`
      <div class="board-head">
        <h2>Opslagstavlen</h2>
        <button class="pill" @click=${() => {
          view = { at: 'write' }
          formId = uuid()
          draft = { title: '', body: '' }
          sent = null
          draw()
        }}>Skriv et opslag</button>
      </div>
      ${errorNote()}
      ${sent ? html`<p class="board-note">${sent}</p>` : nothing}
      ${posts.length === 0 && !busy && !error
        ? html`<p class="board-empty">Der er ikke skrevet noget i gruppen endnu.</p>`
        : nothing}
      <ol class="board-list">
        ${posts.map(post => html`<li>
          <article class="board-post" tabindex="0" role="button"
            @click=${() => openPost(post)}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPost(post) } }}>
            ${postHead(post)}
            ${post.title ? html`<h3>${post.title}</h3>` : nothing}
            <p class="board-body">${lines(post.body)}</p>
            <p class="board-meta">
              ${post.commentCount > 0 ? html`<span>💬 ${post.commentCount}</span>` : nothing}
              ${attachments(post)}
            </p>
          </article>
        </li>`)}
      </ol>
      ${busy ? html`<p class="board-note">Henter …</p>` : nothing}
      ${cursor && !busy ? html`<button class="pill" @click=${() => load()}>${PAGE_TEXT}</button>` : nothing}`
  }

  function postTemplate(post: BoardPost): TemplateResult {
    return html`
      <div class="board-head">
        <button class="pill" @click=${toList}>← Tilbage</button>
      </div>
      <article class="board-post is-open">
        ${postHead(post)}
        ${post.title ? html`<h3>${post.title}</h3>` : nothing}
        <p class="board-body">${lines(post.body)}</p>
        <p class="board-meta">
          ${attachments(post)}
          ${post.url ? html`<a class="board-link" href=${post.url} target="_blank" rel="noreferrer">Åbn på Theta</a>` : nothing}
        </p>
      </article>
      ${errorNote()}
      ${sent ? html`<p class="board-note">${sent}</p>` : nothing}
      <ol class="board-comments">
        ${comments.map(c => html`<li class="board-comment" style=${`--indent:${Math.min(c.depth, 4)}`}>
          <p class="board-by"><strong>${c.author.name}</strong>
            <span class="board-when">${formatPostTime(c.createdAt)}</span></p>
          <p class="board-body">${lines(c.body)}</p>
        </li>`)}
      </ol>
      ${busy ? html`<p class="board-note">Henter …</p>` : nothing}
      ${commentCursor && !busy ? html`<button class="pill" @click=${() => loadComments(post, true)}>${PAGE_TEXT}</button>` : nothing}
      ${writeTemplate('Skriv en kommentar', 'Kommentér')}`
  }

  /** The one form. Theta's App API has no way to answer a comment, so a comment always lands on
   *  the post itself — there is no reply field under each one. */
  function writeTemplate(placeholder: string, action: string, withTitle = false): TemplateResult {
    return html`<form class="board-write" @submit=${(e: Event) => { e.preventDefault(); void send() }}>
      ${withTitle ? html`<input class="board-title" type="text" maxlength="200" placeholder="Overskrift (kan udelades)"
        .value=${draft.title} @input=${(e: Event) => { draft.title = (e.target as HTMLInputElement).value }}>` : nothing}
      <textarea rows=${withTitle ? 6 : 3} maxlength="5000" placeholder=${placeholder} .value=${draft.body}
        @input=${(e: Event) => { draft.body = (e.target as HTMLTextAreaElement).value; draw() }}></textarea>
      <div class="board-write-bar">
        <button class="pill" type="submit" ?disabled=${sending || draft.body.trim().length === 0}>
          ${sending ? 'Sender …' : action}</button>
      </div>
    </form>`
  }

  function template(): TemplateResult {
    return html`<div class="board-dialog" @click=${(e: MouseEvent) => {
      if (e.target === e.currentTarget && e.detail < 2) close()
    }}>
      <div class="board-inner" role="dialog" aria-label="Opslagstavlen">
        <button class="board-close" aria-label="Luk" @click=${close}>×</button>
        ${view.at === 'list' ? listTemplate()
          : view.at === 'post' ? postTemplate(view.post)
          : html`
            <div class="board-head">
              <button class="pill" @click=${toList}>← Tilbage</button>
              <h2>Nyt opslag</h2>
            </div>
            ${errorNote()}
            ${writeTemplate('Hvad vil du sige til klubben?', 'Slå op', true)}
            <p class="board-note">Opslaget står i klubbens gruppe på Theta, som dig, via Albumklubben.dk.</p>`}
      </div>
    </div>`
  }

  const draw = () => { if (open) opts.show(template()) }

  return {
    open() {
      open = true
      view = { at: 'list' }
      sent = null
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
        return page.items
      } catch { return 'error' as const }
    },
    refresh() { if (open && view.at === 'list' && !busy) void load(true) },
  }
}
