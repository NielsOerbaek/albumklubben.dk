import { html, nothing, render, type TemplateResult } from 'lit-html'
import '../base.css'
import './arkiv.css'
import { fetchArchive } from '../api.ts'
import type { Album } from '../../../shared/types.ts'
import type { MapView } from '../../../shared/projection.ts'
import { shelfView, type Filter } from './shelf.ts'
import { mapView } from './map.ts'
import { wallView, type Sort } from './wall.ts'

/** An album together with the number of the meeting it belongs to. */
export interface Entry { album: Album; n: number }

export interface State {
  entries: Entry[]
  selId: number | null
  flipped: boolean
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

const TABS = [['hylden', 'Hylden'], ['kortet', 'Kortet'], ['vaeggen', 'Væggen']] as const
type Tab = (typeof TABS)[number][0]

const state: State = {
  entries: [], selId: null, flipped: false, filter: 'alle', mapView: 'world', panelOpen: false, sort: 'meeting',
}
let status: 'loading' | 'error' | 'ready' = 'loading'
let scrollToSelected = false

const app = document.getElementById('app')!
const tabFromHash = (): Tab => TABS.find(([id]) => `#${id}` === location.hash)?.[0] ?? 'hylden'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function subtitle(tab: Tab): string {
  if (tab === 'kortet') {
    const countries = new Set(state.entries.map((e) => e.album.country).filter(Boolean)).size
    return state.entries.length
      ? `${plural(state.entries.length, 'album', 'albums')} fra ${plural(countries, 'land', 'lande')}`
      : ''
  }
  return tab === 'vaeggen' ? 'Alle albums, sorteret som du vil' : 'Thoravej 29 · hver anden tirsdag 11.30-12.30'
}

const actions: Actions = {
  select(id) {
    Object.assign(state, { selId: id, flipped: false })
    scrollToSelected = true
    draw()
  },
  surprise() {
    const { entries } = state
    if (entries.length) actions.select(entries[Math.floor(Math.random() * entries.length)].album.id)
  },
  set(patch) {
    Object.assign(state, patch)
    draw()
  },
}

function body(tab: Tab): TemplateResult {
  if (status === 'loading') return html`<p class="note">Henter albums…</p>`
  if (status === 'error') return html`<p class="note">Arkivet kunne ikke hentes. Prøv at genindlæse siden.</p>`
  if (!state.entries.length) return html`<p class="note">Der er ingen albums i arkivet endnu.</p>`
  if (tab === 'kortet') return mapView(state, actions)
  if (tab === 'vaeggen') return wallView(state, actions)
  return shelfView(state, actions)
}

function draw() {
  const tab = tabFromHash()
  render(
    html`<header class="top">
        <div class="brand">
          <a class="logo" href="/">Albumklubben</a>
          <span class="sub">${subtitle(tab)}</span>
        </div>
        <nav class="tabs">
          ${TABS.map(([id, label]) =>
            html`<a href="#${id}" aria-current=${tab === id ? 'page' : nothing}>${label}</a>`)}
        </nav>
      </header>
      ${body(tab)}`,
    app,
  )
  if (scrollToSelected) {
    scrollToSelected = false
    app.querySelector('.shelf [aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }
}

window.addEventListener('hashchange', draw)
draw()
fetchArchive().then(
  (archive) => {
    state.entries = archive.meetings.flatMap((m) => m.albums.map((album) => ({ album, n: m.number })))
    state.selId = state.entries.at(-1)?.album.id ?? null
    status = 'ready'
    draw()
  },
  () => {
    status = 'error'
    draw()
  },
)
