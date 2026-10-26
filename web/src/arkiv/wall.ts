import { html, nothing, type TemplateResult } from 'lit-html'
import { albumTemplate } from '../album.ts'
import { textureUrl } from '../api.ts'
import { GENRE_ORDER, genreFamily } from '../../../shared/genre.ts'
import type { Actions, Entry, State } from './main.ts'

export type Sort = 'meeting' | 'decade' | 'genre' | 'country'
const SORTS: [Sort, string][] = [['meeting', 'Møde'], ['decade', 'Årti'], ['genre', 'Genre'], ['country', 'Land']]
const TOP_COUNTRIES = 6

const label = (a: { artist: string; title: string }) => `${a.artist}, ${a.title}`

interface Column { label: string; items: Entry[] }

function group(entries: Entry[], keyOf: (e: Entry) => string, order: (keys: string[], g: Map<string, Entry[]>) => string[]): Column[] {
  const g = new Map<string, Entry[]>()
  for (const e of entries) g.set(keyOf(e), [...(g.get(keyOf(e)) ?? []), e])
  return order([...g.keys()], g).map((k) => ({ label: k, items: g.get(k)! }))
}

const lastOf = (name: string) => (a: string, b: string) => Number(a === name) - Number(b === name)

export function columns(sort: Sort, entries: Entry[]): Column[] {
  if (sort === 'decade') {
    return group(entries, (e) => (e.album.year != null ? `${Math.floor(e.album.year / 10) * 10}'erne` : 'Uden år'),
      (ks) => ks.sort((a, b) => lastOf('Uden år')(a, b) || a.localeCompare(b)))
  }
  if (sort === 'genre') {
    return group(entries, (e) => genreFamily(e.album.genre), (ks) => ks.sort((a, b) =>
      GENRE_ORDER.indexOf(a as never) - GENRE_ORDER.indexOf(b as never)))
  }
  const counts = new Map<string, number>()
  for (const e of entries) if (e.album.country) counts.set(e.album.country, (counts.get(e.album.country) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_COUNTRIES).map(([c]) => c)
  return group(entries, (e) => (top.includes(e.album.country) ? e.album.country : 'Andre lande'),
    (ks, g) => ks.sort((a, b) => lastOf('Andre lande')(a, b) || g.get(b)!.length - g.get(a)!.length || a.localeCompare(b)))
}

const albumsText = (n: number) => `${n} ${n === 1 ? 'album' : 'albums'}`

function detail(e: Entry | undefined, s: State, act: Actions): TemplateResult | typeof nothing {
  if (!e) return nothing
  return html`<section class="detail">${albumTemplate({ album: e.album, meetingNumber: e.n, showTracks: s.showTracks,
    size: 'medium', onToggle: () => act.set({ showTracks: !s.showTracks }) })}</section>`
}

export function wallView(s: State, act: Actions): TemplateResult {
  const tile = (e: Entry, badge: boolean) => html`<button class="tile ${badge ? '' : 'mini'}"
    aria-label=${label(e.album)} title=${label(e.album)} aria-current=${e.album.id === s.selId ? 'true' : 'false'}
    @click=${() => act.set({ selId: e.album.id, showTracks: false })}>
    ${e.album.coverUrl ? html`<img src=${textureUrl(e.album.coverUrl, 128)} alt="" loading="lazy">` : nothing}
    ${badge ? html`<span class="badge">${e.n === s.latest ? `Nyt · ${e.n}` : e.n}</span>` : nothing}
  </button>`
  const newestFirst = s.entries.slice().sort((a, b) => b.n - a.n || a.album.position - b.album.position)

  return html`<section class="sortbar">
      <div class="chips"><span class="muted">Sortér efter</span>
        ${SORTS.map(([id, text]) =>
          html`<button class="pill ${s.sort === id ? 'on' : ''}" aria-pressed=${s.sort === id}
            @click=${() => act.set({ sort: id })}>${text}</button>`)}
      </div>
      <button class="pill outline" @click=${act.surprise}>Overrask mig</button>
    </section>
    ${detail(s.entries.find((e) => e.album.id === s.selId), s, act)}
    ${s.sort === 'meeting'
      ? html`<section class="grid">${newestFirst.map((e) => tile(e, true))}</section>`
      : html`<section class="columns"><div class="colrow">
          ${columns(s.sort, s.entries).map((c) => html`<div class="column">
            <div class="mini-grid">${c.items.map((e) => tile(e, false))}</div>
            <div class="clabel">${c.label}</div>
            <div class="muted small">${albumsText(c.items.length)}</div>
          </div>`)}
        </div></section>`}`
}
