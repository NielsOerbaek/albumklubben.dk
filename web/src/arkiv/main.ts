import { html, nothing, render, type TemplateResult } from 'lit-html'
import '../base.css'
import { topBarTemplate } from '../topbar.ts'
import './arkiv.css'
import { fetchArchive } from '../api.ts'
import type { Album } from '../../../shared/types.ts'
import type { MapView } from '../../../shared/projection.ts'
import { filtered, type Filter } from './filters.ts'
import { coverflowView } from './coverflow.ts'
import { mapView } from './map.ts'
import { statsView } from './stats.ts'
import { albumDialog } from '../album.ts'
import { posterDialog } from '../poster.ts'
import { nextMeeting, nextView, today, type NextPick } from './next.ts'

/** An album together with the number of the meeting it belongs to. */
export interface Entry { album: Album; n: number }

export interface State {
  entries: Entry[]
  selId: number | null
  showTracks: boolean
  filter: Filter
  mapView: MapView
  /** The album held up in a dialog from Kortet or Tal; separate from the Cover Flow selection. */
  dialogId: number | null
  dialogTracks: boolean
}

export interface Actions {
  select(id: number): void
  surprise(): void
  set(patch: Partial<State>): void
}

const SECTIONS = [['hylden', 'Hylden'], ['kortet', 'Kortet'], ['tal', 'Tal']] as const
type Section = (typeof SECTIONS)[number][0]

const state: State = {
  entries: [], selId: null, showTracks: false, filter: 'alle', mapView: 'world', dialogId: null, dialogTracks: false,
}
let status: 'loading' | 'error' | 'ready' = 'loading'
/** The meeting the intro shows, and the poster of it held up in a dialog. */
let pick: NextPick | null = null
let posterId: number | null = null

const app = document.getElementById('app')!
/** The section in the hash, if any; the old `#vaeggen` tab lives on as Tal. */
function sectionFromHash(): Section | null {
  const id = location.hash.slice(1)
  return id === 'vaeggen' ? 'tal' : SECTIONS.find(([s]) => s === id)?.[0] ?? null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function mapLine(): string {
  const countries = new Set(state.entries.map((e) => e.album.country).filter(Boolean)).size
  return `${plural(state.entries.length, 'album', 'albums')} fra ${plural(countries, 'land', 'lande')}`
}

const actions: Actions = {
  select(id) {
    actions.set({ selId: id, showTracks: false })
  },
  surprise() {
    const pool = filtered(state.entries, state.filter).filter((e) => e.album.id !== state.selId)
    if (pool.length) actions.select(pool[Math.floor(Math.random() * pool.length)].album.id)
  },
  set(patch) {
    Object.assign(state, patch)
    draw()
  },
}

const head = (title: string, line: string) =>
  html`<header class="sec-head"><h2>${title}</h2><p class="muted">${line}</p></header>`

const openAlbum = (id: number) => actions.set({ dialogId: id, dialogTracks: false })

/** The album dialog, over the poster dialog when it was opened from one (Tilbage goes back to it). */
function dialog(): TemplateResult | typeof nothing {
  const e = state.entries.find((x) => x.album.id === state.dialogId)
  if (e) return albumDialog({ album: e.album, meetingNumber: e.n, showTracks: state.dialogTracks, size: 'medium',
    onToggle: () => actions.set({ dialogTracks: !state.dialogTracks }),
    onBack: posterId != null ? () => actions.set({ dialogId: null }) : undefined,
    onClose: () => { posterId = null; actions.set({ dialogId: null }) } })
  const meeting = pick?.meeting
  const poster = meeting?.posters.find((p) => p.id === posterId)
  if (!meeting || !poster) return nothing
  return posterDialog({ poster, meeting, onAlbum: (a) => openAlbum(a.id),
    onClose: () => { posterId = null; draw() } })
}

const nextActions = { album: openAlbum, poster: (id: number) => { posterId = id; draw() } }

function body(): TemplateResult {
  if (status === 'loading') return html`<p class="note">Henter albums…</p>`
  if (status === 'error') return html`<p class="note">Arkivet kunne ikke hentes. Prøv at genindlæse siden.</p>`
  if (!state.entries.length) return html`<p class="note">Der er ingen albums i arkivet endnu.</p>`
  return html`${nextView(pick, nextActions)}${sections()}<section id="hylden" class="sec">${coverflowView(state, actions)}</section>
    <section id="kortet" class="sec">${head('Kortet', mapLine())}${mapView(state, actions)}</section>
    <section id="tal" class="sec">${head('Tal', 'Arkivet i tal')}${statsView(state, actions)}</section>${dialog()}`
}

/** The sticky row of section links between the intro and the sections. */
function sections(): TemplateResult {
  const current = sectionFromHash()
  return html`<nav class="sections" aria-label="Afsnit">
    ${SECTIONS.map(([id, label]) =>
      html`<a class="pill" href="#${id}" aria-current=${current === id ? 'page' : nothing}>${label}</a>`)}
  </nav>`
}

function draw() {
  render(html`${topBarTemplate(null)}${body()}`, app)
}

/** Brings the hash's section into view; without one, the intro at the top. */
function scrollToSection(behavior: ScrollBehavior) {
  const id = sectionFromHash()
  if (!id) window.scrollTo({ top: 0, behavior })
  else document.getElementById(id)?.scrollIntoView({ block: 'start', behavior })
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (state.dialogId != null) actions.set({ dialogId: null })
  else if (posterId != null) { posterId = null; draw() }
})
window.addEventListener('hashchange', () => {
  draw()
  scrollToSection('smooth')
})
draw()
fetchArchive().then(
  (archive) => {
    state.entries = archive.meetings.flatMap((m) => m.albums.map((album) => ({ album, n: m.number })))
    pick = nextMeeting(archive.meetings, today())
    state.selId = state.entries.at(-1)?.album.id ?? null
    status = 'ready'
    draw()
    if (location.hash) scrollToSection('auto')
  },
  () => {
    status = 'error'
    draw()
  },
)
