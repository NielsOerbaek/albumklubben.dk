import { html, nothing, render, type TemplateResult } from 'lit-html'
import { live } from 'lit-html/directives/live.js'
import '../base.css'
import './lyttefest.css'
import { topBarTemplate } from '../topbar.ts'
import { thumbUrl } from '../api.ts'
import { faceTemplate } from '../face.ts'
import { loadMe } from '../me.ts'
import { formatPostTime } from '../../../shared/board.ts'
import {
  catchUpText, formatClock, formatCountdown, formatLength, positionAt, searchLinks, totalSeconds,
  type FestComment, type FestFace, type FestPosition, type FestTrack, type FestView,
} from '../../../shared/lyttefest.ts'

/**
 * Lyttefesten: one album, one time, everybody on their own speakers. The page's only job is to
 * keep everyone on the same track, which it does by counting from the start time on the server's
 * clock — never the browser's, which may be minutes out.
 *
 * What is said is laid out along the album: every track that has played has a bar of its own,
 * stacked in playing order, and a comment sits on that bar at the moment it was written.
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

/** Where a comment sits on the album: which track it was written during, and how far into it. */
const commentAt = (c: FestComment): FestPosition =>
  positionAt(fest!.tracks, Date.parse(fest!.startsAt), Date.parse(c.createdAt))

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
  focusWrite()
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

const focusWrite = () => document.querySelector<HTMLTextAreaElement>('.fest-write textarea')?.focus()

// --- The page ------------------------------------------------------------------------------------

const person = (name: string) => html`<span class="fest-person">${name}</span>`

/** A face and a name together, which is how a member is named anywhere there is room for it. */
const named = (who: FestFace, size = 22) =>
  html`<span class="fest-named">${faceTemplate(who, size)}${person(who.name)}</span>`

/** Where a comment was written, in words: "4. Wuthering Heights · 1:32". */
function stampOf(c: FestComment): string {
  const at = commentAt(c)
  return at.track ? `${at.track.number}. ${at.track.title} · ${formatClock(at.into)}` : formatPostTime(c.createdAt)
}

/** A comment goes only when its own author or the host takes it down. */
function commentTemplate(c: FestComment): TemplateResult {
  const mine = fest !== null && (c.sub === fest.you.sub || fest.you.host)
  return html`<li class="fest-comment" id=${`k${c.id}`}>
    <p class="fest-comment-by">${named(c)}
      <span class="fest-when">${stampOf(c)}</span>
      ${mine ? html`<button class="fest-remove" aria-label="Fjern kommentaren" @click=${() => remove(c.id)}>×</button>` : nothing}</p>
    <p class="fest-comment-text">${c.text}</p>
  </li>`
}

/**
 * A comment where it was written: the writer's face on the bar, and what they said in a card that
 * comes up under the pointer, so a whole track can be read without going down the list.
 *
 * The card is placed off the percentage we already have rather than by measuring: near either end
 * of the bar it hangs from that end instead of from the middle, which is what keeps it on the
 * page. The mark is `aria-hidden` throughout — every comment is also in the list below, where it
 * can be read and removed, so nothing here is only reachable by hovering.
 */
function markTemplate(c: FestComment, x: number): TemplateResult {
  const side = x < 18 ? 'at-start' : x > 82 ? 'at-end' : ''
  return html`<span class="fest-mark ${side}" aria-hidden="true" style=${`left:${x}%`}>
    ${faceTemplate(c, 16)}
    <span class="fest-peek">
      <span class="fest-peek-by">${c.name} <span class="fest-when">${stampOf(c)}</span></span>
      <span class="fest-peek-text">${c.text}</span>
    </span>
  </span>`
}

/**
 * One track's bar: how far through it we are, with every comment written during it sitting at the
 * moment it was written. The track playing now also carries the playhead and a chat mark that
 * comes up under the pointer, so a comment can be written from where you are looking.
 */
function laneTemplate(track: FestTrack, p: FestPosition, said: FestComment[]): TemplateResult {
  const isNow = p.state === 'nu' && p.track?.number === track.number
  const done = p.state === 'slut' || (p.track != null && p.track.number > track.number)
  const filled = isNow ? (p.into / track.seconds) * 100 : done ? 100 : 0
  const at = (c: FestComment) => Math.min(100, Math.max(0, (commentAt(c).into / track.seconds) * 100))
  return html`<li class="fest-lane ${isNow ? 'is-now' : ''}">
    <p class="fest-lane-head">
      <span class="no">${track.number}</span>
      <span class="fest-lane-title">${track.title}</span>
      <span class="len">${isNow ? `${formatClock(p.into)} / ${formatClock(track.seconds)}` : formatClock(track.seconds)}</span>
    </p>
    <div class="fest-lane-bar">
      <div class="fest-lane-fill" style=${`width:${filled}%`}></div>
      ${said.map(c => markTemplate(c, at(c)))}
      ${isNow ? html`
        <span class="fest-playhead" style=${`left:${filled}%`}></span>
        <button class="fest-add" style=${`left:${filled}%`} title="Skriv herfra"
          aria-label="Skriv en kommentar her" @click=${focusWrite}>💬</button>` : nothing}
    </div>
    ${said.length ? html`<ol class="fest-comments">${said.map(commentTemplate)}</ol>` : nothing}
  </li>`
}

/** The album as a stack of bars: every track that has played, in playing order, newest at the foot. */
function lanesTemplate(f: FestView, p: FestPosition): TemplateResult {
  const byTrack = new Map<number | null, FestComment[]>()
  for (const c of f.comments) {
    const index = commentAt(c).track?.number ?? null
    byTrack.set(index, [...(byTrack.get(index) ?? []), c])
  }
  const last = p.state === 'nu' && p.track ? p.track.number : f.tracks.length
  const lanes = p.state === 'kommende' ? [] : f.tracks.filter(t => t.number <= last)
  const outside = byTrack.get(null) ?? []
  return html`
    <ol class="fest-lanes">${lanes.map(t => laneTemplate(t, p, byTrack.get(t.number) ?? []))}</ol>
    ${outside.length ? html`<section class="fest-outside">
      <h2>Uden for numrene</h2>
      <ol class="fest-comments">${outside.map(commentTemplate)}</ol>
    </section>` : nothing}`
}

/** Enter sends; shift and enter makes a new line. */
const writeTemplate = () => html`
  <form class="fest-write" @submit=${(e: Event) => { e.preventDefault(); void comment() }}>
    <textarea rows="2" maxlength="500" placeholder="Skriv her — Enter sender" .value=${live(draft)}
      @input=${(e: Event) => { draft = (e.target as HTMLTextAreaElement).value }}
      @keydown=${(e: KeyboardEvent) => {
        // `isComposing` keeps Enter out of the way while a keyboard is composing a character.
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void comment() }
      }}></textarea>
    <button class="pill" type="submit" ?disabled=${sending}>${sending ? 'Sender …' : 'Send'}</button>
  </form>
  <p class="fest-note">Det, du skriver, bliver her på siden. Når lyttefesten er slut, siger botten
    kun i gruppen, hvor mange der var med, og hvor meget der blev skrevet.</p>`

/** Who is coming, or — once it is over — who came. There is nothing to answer by then. */
const comingTemplate = (f: FestView, p: FestPosition) => {
  const over = p.state === 'slut' || p.state === 'aflyst'
  return html`<section class="fest-coming">
    <h2>${over ? 'Kom' : 'Kommer'} (${f.coming.length})</h2>
    ${f.coming.length === 0
      ? html`<p>${over ? 'Ingen nåede det.' : 'Ingen har sagt ja endnu.'}</p>`
      : html`<ul class="fest-people">${f.coming.map(c => html`<li>${named(c, 26)}</li>`)}</ul>`}
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
      <p class="fest-catch">${catchUpText(p)}</p>
    </section>
    <section class="fest-talk">
      <h2>Undervejs</h2>
      ${lanesTemplate(f, p)}
      ${writeTemplate()}
    </section>
    ${left.length ? html`<section class="fest-next">
      <h2>Herefter</h2>
      <ol>${left.map(t => html`<li><span class="no">${t.number}</span> ${t.title}
        <span class="len">${formatClock(t.seconds)}</span></li>`)}</ol>
    </section>` : nothing}
    ${comingTemplate(f, p)}`
}

function afterTemplate(f: FestView, p: FestPosition): TemplateResult {
  return html`
    <p class="fest-countdown">${f.cancelled ? 'Lyttefesten er aflyst' : 'Lyttefesten er slut'}</p>
    ${f.cancelled ? nothing : html`<section class="fest-talk">${lanesTemplate(f, p)}</section>`}
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
          · Vært: ${named(f.host, 20)}
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
  render(html`${topBarTemplate(null)}${body()}`, app)
}

// Coming back to the tab may be hours later: the clock is measured again and the state refetched.
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load() })

if (!Number.isFinite(id)) {
  error = 'Lyttefesten findes ikke'
  draw()
} else {
  draw()
  void loadMe(draw)
  void load().then(listen)
  // A second is as fine as the counting needs to be.
  setInterval(() => { if (fest && !document.hidden) draw() }, 1000)
}
