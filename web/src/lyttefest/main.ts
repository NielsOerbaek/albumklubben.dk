import { html, nothing, render, type TemplateResult } from 'lit-html'
import '../base.css'
import './lyttefest.css'
import { topBarTemplate } from '../topbar.ts'
import { createBoard } from '../board/board.ts'
import { thumbUrl } from '../api.ts'
import { formatPostTime } from '../../../shared/board.ts'
import {
  catchUpText, formatClock, formatCountdown, formatLength, positionAt, searchLinks, totalSeconds,
  type FestComment, type FestPosition, type FestView,
} from '../../../shared/lyttefest.ts'

/**
 * Lyttefesten: one album, one time, everybody on their own speakers. The page's only job is to
 * keep everyone on the same track, which it does by counting from the start time on the server's
 * clock — never the browser's, which may be minutes out.
 */
const app = document.getElementById('app')!
const id = Number(/\/lyttefest\/(\d+)/.exec(location.pathname)?.[1])

let fest: FestView | null = null
let error: string | null = null
/** The server's clock, less this browser's. Measured when the page loads and when it comes back. */
let offset = 0
let draft = ''
let sending = false
let busy = false

const boardLayer = document.createElement('div')
document.body.append(boardLayer)
const board = createBoard({ show: (content) => render(content ?? nothing, boardLayer) })

const serverNow = () => Date.now() + offset

async function ask<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, ...init })
  const body = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(body?.error ?? 'Noget gik galt')
  return body as T
}

async function load() {
  busy = true
  try {
    const sent = Date.now()
    const got = await ask<FestView>(`/api/lyttefest/${id}`)
    // Half the round trip is the best guess at how old the server's answer is.
    offset = Date.parse(got.now) + (Date.now() - sent) / 2 - Date.now()
    fest = got
    error = null
  } catch (err) {
    error = err instanceof Error ? err.message : 'Lyttefesten kan ikke hentes'
  }
  busy = false
  draw()
}

/** The live stream: new comments, who is coming, and the state changing. */
function listen() {
  const source = new EventSource(`/api/lyttefest/${id}/events`)
  const on = (name: string, run: (data: any) => void) =>
    source.addEventListener(name, (e) => { run(JSON.parse((e as MessageEvent).data)); draw() })
  on('comment', (c: FestComment) => { if (fest && !fest.comments.some(x => x.id === c.id)) fest.comments.push(c) })
  on('deleted', ({ id: gone }) => { if (fest) fest.comments = fest.comments.filter(c => c.id !== gone) })
  on('coming', (people) => {
    if (!fest) return
    fest.coming = people
    fest.you.coming = people.some((p: { sub: string }) => p.sub === fest!.you.sub)
  })
  on('moved', ({ startsAt }) => { if (fest) fest.startsAt = startsAt })
  on('cancelled', () => { if (fest) fest.cancelled = true })
  on('started', () => {})
  on('ended', () => {})
  // A dropped stream is the browser's to reconnect; a long gap is caught by the reload below.
  source.onerror = () => {}
}

const where = (): FestPosition =>
  positionAt(fest!.tracks, Date.parse(fest!.startsAt), serverNow(), fest!.cancelled)

// --- Doing things -------------------------------------------------------------------------------

async function rsvp(coming: boolean) {
  if (!fest) return
  try {
    const res = await ask<{ coming: FestView['coming'] }>(`/api/lyttefest/${id}/rsvp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ coming }),
    })
    fest.coming = res.coming
    fest.you.coming = coming
  } catch (err) { error = (err as Error).message }
  draw()
}

async function comment() {
  const text = draft.trim()
  if (!text || sending || !fest) return
  sending = true
  draw()
  try {
    const made = await ask<FestComment>(`/api/lyttefest/${id}/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
    })
    if (!fest.comments.some(c => c.id === made.id)) fest.comments.push(made)
    draft = ''
  } catch (err) { error = (err as Error).message }
  sending = false
  draw()
}

async function remove(commentId: number) {
  try {
    await ask(`/api/lyttefest/${id}/comments/${commentId}`, { method: 'DELETE' })
    if (fest) fest.comments = fest.comments.filter(c => c.id !== commentId)
  } catch (err) { error = (err as Error).message }
  draw()
}

async function host(what: 'aflys' | 'udskyd', startsAt?: string) {
  if (what === 'aflys' && !confirm('Skal lyttefesten aflyses?')) return
  try {
    fest = await ask<FestView>(`/api/lyttefest/${id}/${what}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startsAt }),
    })
    error = null
  } catch (err) { error = (err as Error).message }
  draw()
}

/** The host moving it: a local date and time, read as Copenhagen time like the form that made it. */
function askNewTime() {
  const when = prompt('Nyt tidspunkt (fx 2026-11-03 11:30)')
  if (!when) return
  const at = new Date(when.replace(' ', 'T'))
  if (Number.isNaN(at.getTime())) { error = 'Det kunne ikke læses som et tidspunkt'; return draw() }
  void host('udskyd', at.toISOString())
}

// --- The page ------------------------------------------------------------------------------------

const person = (name: string) => html`<span class="fest-person">${name}</span>`

/** A comment goes only when its own author or the host takes it down. */
function commentTemplate(c: FestComment): TemplateResult {
  const mine = fest !== null && (c.sub === fest.you.sub || fest.you.host)
  return html`<li class="fest-comment">
    <p class="fest-comment-by">${person(c.name)}
      <span class="fest-when">${formatPostTime(c.createdAt)}</span>
      ${mine ? html`<button class="fest-remove" aria-label="Fjern kommentaren" @click=${() => remove(c.id)}>×</button>` : nothing}</p>
    <p class="fest-comment-text">${c.text}</p>
  </li>`
}

const writeTemplate = () => html`
  <form class="fest-write" @submit=${(e: Event) => { e.preventDefault(); void comment() }}>
    <textarea rows="2" maxlength="500" placeholder="Hvad synes du?" .value=${draft}
      @input=${(e: Event) => { draft = (e.target as HTMLTextAreaElement).value; draw() }}></textarea>
    <button class="pill" type="submit" ?disabled=${sending || draft.trim().length === 0}>
      ${sending ? 'Sender …' : 'Send'}</button>
  </form>
  <p class="fest-note">Kommentarerne samles i ét opslag i gruppen på Theta, når lyttefesten er slut.</p>`

/** Who is coming, or — once it is over — who came. There is nothing to answer by then. */
const comingTemplate = (f: FestView, p: FestPosition) => {
  const over = p.state === 'slut' || p.state === 'aflyst'
  return html`<section class="fest-coming">
    <h2>${over ? 'Kom' : 'Kommer'} (${f.coming.length})</h2>
    <p>${f.coming.length === 0
      ? (over ? 'Ingen nåede det.' : 'Ingen har sagt ja endnu.')
      : f.coming.map((c, i) => html`${i > 0 ? ', ' : ''}${person(c.name)}`)}</p>
    ${over ? nothing : html`<button class="pill ${f.you.coming ? 'on' : ''}" @click=${() => rsvp(!f.you.coming)}>
      ${f.you.coming ? 'Jeg kommer ikke alligevel' : 'Jeg kommer'}</button>`}
  </section>`
}

const hostTemplate = (f: FestView, p: FestPosition) => f.you.host && p.state === 'kommende'
  ? html`<section class="fest-host">
      <button class="pill" @click=${askNewTime}>Udskyd</button>
      <button class="pill" @click=${() => host('aflys')}>Aflys</button>
    </section>`
  : nothing

function beforeTemplate(f: FestView, p: FestPosition): TemplateResult {
  return html`
    <p class="fest-countdown">Starter ${formatCountdown(p.seconds)}</p>
    <p class="fest-lead">Find albummet, og tryk play, når nedtællingen når 0.</p>
    <section class="fest-find">
      <h2>Find albummet</h2>
      <p>${searchLinks(f.album.artist, f.album.title).map((l, i) => html`${i > 0 ? ' · ' : ''}
        <a href=${l.url} target="_blank" rel="noreferrer">${l.name}</a>`)}</p>
    </section>
    ${comingTemplate(f, p)}
    ${hostTemplate(f, p)}`
}

function duringTemplate(f: FestView, p: FestPosition): TemplateResult {
  const track = p.track!
  const left = f.tracks.slice(track.number)
  return html`
    <section class="fest-now">
      <p class="fest-now-label">Nummer ${track.number} af ${f.tracks.length}</p>
      <h2 class="fest-track">${track.title}</h2>
      <div class="fest-bar"><div class="fest-bar-fill" style=${`width:${(p.into / track.seconds) * 100}%`}></div></div>
      <p class="fest-clock">${formatClock(p.into)} / ${formatClock(track.seconds)}</p>
      <p class="fest-catch">${catchUpText(p)}</p>
    </section>
    ${left.length ? html`<section class="fest-next">
      <h2>Herefter</h2>
      <ol>${left.map(t => html`<li><span class="no">${t.number}</span> ${t.title}
        <span class="len">${formatClock(t.seconds)}</span></li>`)}</ol>
    </section>` : nothing}
    <section class="fest-talk">
      <h2>Undervejs</h2>
      ${writeTemplate()}
      <ol class="fest-comments">${[...f.comments].reverse().map(commentTemplate)}</ol>
    </section>
    ${comingTemplate(f, p)}`
}

function afterTemplate(f: FestView, p: FestPosition): TemplateResult {
  const byTrack = new Map<number | null, FestComment[]>()
  for (const c of f.comments) byTrack.set(c.trackIndex, [...(byTrack.get(c.trackIndex) ?? []), c])
  return html`
    <p class="fest-countdown">${f.cancelled ? 'Lyttefesten er aflyst' : 'Lyttefesten er slut'}</p>
    ${f.cancelled ? nothing : html`<section class="fest-after">
      <ol class="fest-tracklist">
        ${f.tracks.map(t => html`<li>
          <p class="fest-track-line"><span class="no">${t.number}</span> ${t.title}
            <span class="len">${formatClock(t.seconds)}</span></p>
          ${(byTrack.get(t.number - 1) ?? []).length
            ? html`<ol class="fest-comments">${byTrack.get(t.number - 1)!.map(commentTemplate)}</ol>`
            : nothing}
        </li>`)}
      </ol>
      ${(byTrack.get(null) ?? []).length ? html`<section class="fest-talk">
        <h2>Udenfor numrene</h2>
        <ol class="fest-comments">${byTrack.get(null)!.map(commentTemplate)}</ol>
      </section>` : nothing}
    </section>`}
    ${comingTemplate(f, p)}`
}

function body(): TemplateResult {
  if (error && !fest) return html`<main class="fest"><p class="fest-error">${error}</p></main>`
  if (!fest) return html`<main class="fest"><p class="fest-note">${busy ? 'Henter lyttefesten …' : ''}</p></main>`
  const f = fest
  const p = where()
  const cover = f.album.coverUrl ? thumbUrl(f.album.coverUrl, 512) : null
  return html`<main class="fest" style=${`--card-bg:${f.album.cardColor}`}>
    <header class="fest-head">
      ${cover ? html`<img class="fest-cover" src=${cover} alt="">` : nothing}
      <div>
        <p class="fest-kicker">Lyttefest${p.state === 'nu' ? ' · nu' : ''}</p>
        <h1>${f.album.artist} – ${f.album.title}</h1>
        <p class="fest-facts">
          ${f.album.year ? html`${f.album.year} · ` : nothing}${formatLength(totalSeconds(f.tracks))}
          · Vært: ${person(f.host.name)}
          ${f.thetaUrl ? html` · <a href=${f.thetaUrl} target="_blank" rel="noreferrer">Opslaget på Theta</a>` : nothing}
        </p>
        ${f.note ? html`<p class="fest-lead">${f.note}</p>` : nothing}
      </div>
    </header>
    ${error ? html`<p class="fest-error">${error}</p>` : nothing}
    ${p.state === 'kommende' ? beforeTemplate(f, p)
      : p.state === 'nu' ? duringTemplate(f, p)
      : afterTemplate(f, p)}
  </main>`
}

function draw() {
  render(html`${topBarTemplate(null, undefined, () => board.open())}${body()}`, app)
}

window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && board.isOpen()) board.close() })
// Coming back to the tab may be hours later: the clock is measured again and the state refetched.
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load() })

if (!Number.isFinite(id)) {
  error = 'Lyttefesten findes ikke'
  draw()
} else {
  draw()
  void load().then(listen)
  // A second is as fine as the counting needs to be.
  setInterval(() => { if (fest && !document.hidden) draw() }, 1000)
}
