import { html, nothing, type TemplateResult } from 'lit-html'
import { textureUrl } from '../api.ts'
import { GENRE_ORDER, genreFamily } from '../../../shared/genre.ts'
import { EMPTY_LINEUP, lineupTotal, LINEUP_KEYS, LINEUP_LABEL, type LineupKey } from '../../../shared/gender.ts'
import type { Actions, Entry, State } from './main.ts'

export type Dimension = 'decade' | 'genre' | 'country' | 'gender'
const DIMENSIONS: [Dimension, string][] = [['decade', 'Årti'], ['genre', 'Genre'], ['country', 'Land'], ['gender', 'Køn']]
const TOP_COUNTRIES = 6

const label = (a: { artist: string; title: string }) => `${a.artist}, ${a.title}`

export interface ColumnItem {
  entry: Entry
  /** How many of this column's kind are on the album, where that is more than one. */
  n?: number
}

interface Column {
  label: string
  items: ColumnItem[]
  /** Under the label, in place of the usual share. */
  sub?: string
}

function group(entries: Entry[], keyOf: (e: Entry) => string, order: (keys: string[], g: Map<string, Entry[]>) => string[]): Column[] {
  const g = new Map<string, Entry[]>()
  for (const e of entries) g.set(keyOf(e), [...(g.get(keyOf(e)) ?? []), e])
  return order([...g.keys()], g).map((k) => ({ label: k, items: g.get(k)!.map((entry) => ({ entry })) }))
}

/**
 * Køn is the one dimension where an album can stand in more than one column: a band of five men
 * and one woman is in both, with a 5 on it in the one and nothing on it in the other. The share
 * would be a lie here — the columns would add up past the whole — so it counts people instead.
 */
function genderColumns(entries: Entry[]): Column[] {
  // An album nobody has counted yet stands under Andet rather than dropping out of the chart.
  const of = (e: Entry) => (lineupTotal(e.album.lineup) > 0 ? e.album.lineup : { ...EMPTY_LINEUP, other: 1 })
  return LINEUP_KEYS.flatMap((key: LineupKey) => {
    const items: ColumnItem[] = []
    let people = 0
    for (const entry of entries) {
      const n = of(entry)[key]
      if (n <= 0) continue
      items.push({ entry, n: n > 1 ? n : undefined })
      people += n
    }
    if (items.length === 0) return [] // a column nobody is in is not drawn
    const a = `${items.length} ${items.length === 1 ? 'album' : 'albums'}`
    return [{ label: LINEUP_LABEL[key], items, sub: `${a} · ${people} i alt` }]
  })
}

const lastOf = (name: string) => (a: string, b: string) => Number(a === name) - Number(b === name)
const bySize = (last: string) => (ks: string[], g: Map<string, Entry[]>) =>
  ks.sort((a, b) => lastOf(last)(a, b) || g.get(b)!.length - g.get(a)!.length || a.localeCompare(b))

export function columns(dim: Dimension, entries: Entry[]): Column[] {
  if (dim === 'decade') {
    return group(entries, (e) => (e.album.year != null ? `${Math.floor(e.album.year / 10) * 10}'erne` : 'Uden år'),
      (ks) => ks.sort((a, b) => lastOf('Uden år')(a, b) || a.localeCompare(b)))
  }
  if (dim === 'genre') {
    return group(entries, (e) => genreFamily(e.album.genre), (ks) => ks.sort((a, b) =>
      GENRE_ORDER.indexOf(a as never) - GENRE_ORDER.indexOf(b as never)))
  }
  if (dim === 'gender') return genderColumns(entries)
  const counts = new Map<string, number>()
  for (const e of entries) if (e.album.country) counts.set(e.album.country, (counts.get(e.album.country) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_COUNTRIES).map(([c]) => c)
  return group(entries, (e) => (top.includes(e.album.country) ? e.album.country : 'Andre lande'), bySize('Andre lande'))
}

/** "10 albums · 23%". */
export function shareLabel(n: number, total: number): string {
  return `${n} ${n === 1 ? 'album' : 'albums'} · ${Math.round((100 * n) / total)}%`
}

export function headline(entries: Entry[], meetings: number): { label: string; value: number }[] {
  return [
    { label: 'Albums', value: entries.length },
    { label: 'Møder', value: meetings },
    { label: 'Lande', value: new Set(entries.map((e) => e.album.country).filter(Boolean)).size },
    { label: 'Nostalgialbums', value: entries.filter((e) => e.album.pickedByName).length },
  ]
}

export function statsView(s: State, act: Actions): TemplateResult {
  const meetings = new Set(s.entries.map((e) => e.n)).size
  const tile = ({ entry: e, n }: ColumnItem) => html`<button class="tile mini"
    aria-label=${n ? `${label(e.album)} (${n})` : label(e.album)}
    title=${n ? `${label(e.album)} — ${n}` : label(e.album)}
    @click=${() => act.set({ dialogId: e.album.id, dialogTracks: false })}>
    ${e.album.coverUrl ? html`<img src=${textureUrl(e.album.coverUrl, 128)} alt="" loading="lazy">` : nothing}
    ${n ? html`<span class="tile-badge" aria-hidden="true">${n}</span>` : nothing}
  </button>`
  return html`<div class="headline">${headline(s.entries, meetings).map((h) =>
      html`<div class="figure"><span class="num">${h.value}</span><span class="muted">${h.label}</span></div>`)}</div>
    ${DIMENSIONS.map(([dim, text]) => html`<section class="columns">
      <h3 class="dim">${text}</h3>
      <div class="colrow">${columns(dim, s.entries).map((c) => html`<div class="column">
        <div class="mini-grid">${c.items.map(tile)}</div>
        <div class="clabel">${c.label}<span class="muted small">${c.sub ?? shareLabel(c.items.length, s.entries.length)}</span></div>
      </div>`)}</div>
    </section>`)}`
}
