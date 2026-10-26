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
import { latestMeetingWithAlbums } from '../../../shared/latest.ts'
import { wallView, type Sort } from './wall.ts'

/** An album together with the number of the meeting it belongs to. */
export interface Entry { album: Album; n: number }

export interface State {
  entries: Entry[]
  /** Number of the latest meeting with albums. */
  latest: number | null
  selId: number | null
  showTracks: boolean
  filter: Filter
  mapView: MapView
  panelOpen: boolean
  sort: Sort
}

export interface Actions {
  select(id: number): void
  surprise(): void
  set(patch: Partial<State>): void
}

const SECTIONS = [['hylden', 'Hylden'], ['kortet', 'Kortet'], ['tal', 'Tal']] as const
type Section = (typeof SECTIONS)[number][0]

const state: State = {
  entries: [], latest: null, selId: null, showTracks: false, filter: 'alle', mapView: 'world', panelOpen: false, sort: 'meeting',
}
let status: 'loading' | 'error' | 'ready' = 'loading'

const app = document.getElementById('app')!
/** The section in the hash; the old `#vaeggen` tab lives on as Tal. */
function sectionFromHash(): Section {
  const id = location.hash.slice(1)
  return id === 'vaeggen' ? 'tal' : SECTIONS.find(([s]) => s === id)?.[0] ?? 'hylden'
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

function body(): TemplateResult {
  if (status === 'loading') return html`<p class="note">Henter albums…</p>`
  if (status === 'error') return html`<p class="note">Arkivet kunne ikke hentes. Prøv at genindlæse siden.</p>`
  if (!state.entries.length) return html`<p class="note">Der er ingen albums i arkivet endnu.</p>`
  return html`<section id="hylden" class="sec">${coverflowView(state, actions)}</section>
    <section id="kortet" class="sec">${head('Kortet', mapLine())}${mapView(state, actions)}</section>
    <section id="tal" class="sec">${head('Tal', 'Alle albums, sorteret som du vil')}${wallView(state, actions)}</section>`
}

function draw() {
  const current = sectionFromHash()
  render(
    html`${topBarTemplate('arkiv')}
      <nav class="sections" aria-label="Afsnit">
        ${SECTIONS.map(([id, label]) =>
          html`<a class="pill" href="#${id}" aria-current=${current === id ? 'page' : nothing}>${label}</a>`)}
        <span class="muted where">Thoravej 29 · hver anden tirsdag 11.30-12.30</span>
      </nav>
      ${body()}`,
    app,
  )
}

/** Brings the hash's section into view; Hylden is the top of the page. */
function scrollToSection(behavior: ScrollBehavior) {
  const id = sectionFromHash()
  if (id === 'hylden') window.scrollTo({ top: 0, behavior })
  else document.getElementById(id)?.scrollIntoView({ block: 'start', behavior })
}

window.addEventListener('hashchange', () => {
  draw()
  scrollToSection('smooth')
})
draw()
fetchArchive().then(
  (archive) => {
    state.entries = archive.meetings.flatMap((m) => m.albums.map((album) => ({ album, n: m.number })))
    state.latest = latestMeetingWithAlbums(archive.meetings)?.number ?? null
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
