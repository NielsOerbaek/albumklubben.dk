import { html, nothing, type TemplateResult } from 'lit-html'
import { albumTemplate } from '../album.ts'
import { textureUrl } from '../api.ts'
import type { Actions, Entry, State } from './main.ts'

export type Filter = 'alle' | 'nostalgi' | 'dk' | 'old' | 'recent'

/** The two most recent years in the data, newest first. */
export function recentYears(entries: Entry[]): number[] {
  const years = new Set(entries.flatMap((e) => (e.album.year != null ? [e.album.year] : [])))
  return [...years].sort((a, b) => b - a).slice(0, 2)
}

function recentLabel(years: number[]): string {
  const [hi, lo] = years
  if (lo === undefined) return String(hi)
  return hi - lo === 1 ? `${lo}-${String(hi).slice(2)}` : `${lo} og ${hi}`
}

export function matches(filter: Filter, e: Entry, recent: number[]): boolean {
  const a = e.album
  switch (filter) {
    case 'nostalgi': return !!a.pickedByName
    case 'dk': return a.country === 'Danmark'
    case 'old': return a.year != null && a.year < 2000
    case 'recent': return a.year != null && recent.includes(a.year)
    default: return true
  }
}

const label = (a: { artist: string; title: string }) => `${a.artist}, ${a.title}`

/** Group entries by meeting, keeping their order. */
function byMeeting(entries: Entry[]): [number, Entry[]][] {
  const groups = new Map<number, Entry[]>()
  for (const e of entries) groups.set(e.n, [...(groups.get(e.n) ?? []), e])
  return [...groups]
}

export function shelfView(s: State, act: Actions): TemplateResult {
  const { entries } = s
  const idx = Math.max(0, entries.findIndex((e) => e.album.id === s.selId))
  const { album, n } = entries[idx]
  const go = (i: number) => act.select(entries[(i + entries.length) % entries.length].album.id)
  const recent = recentYears(entries)
  const filters: [Filter, string][] = [
    ['alle', `Alle ${entries.length}`], ['nostalgi', 'Nostalgialbums'], ['dk', 'Danske'], ['old', 'Før 2000'],
  ]
  if (recent.length) filters.push(['recent', recentLabel(recent)])
  const flip = () => act.set({ showTracks: !s.showTracks })
  const meta = [album.year, album.country].filter((v) => v != null && v !== '').join(' · ')

  return html`<main class="stage">
      ${albumTemplate({ album, meetingNumber: n, showTracks: s.showTracks, onToggle: flip })}
      <section class="info">
        <div class="kicker">Møde ${n} <i class="dot" style="background:${album.cardColor}"></i> ${meta}</div>
        <h1>${album.title}</h1>
        <div class="artist">${album.artist}</div>
        <div class="buttons">
          <button class="pill" @click=${() => go(idx - 1)}>← Forrige</button>
          <button class="pill" @click=${() => go(idx + 1)}>Næste →</button>
          <button class="pill outline" @click=${act.surprise}>Overrask mig</button>
        </div>
      </section>
    </main>
    <section class="shelfbar">
      <div class="chips"><span class="muted">Vis</span>
        ${filters.map(([id, text]) =>
          html`<button class="pill ${s.filter === id ? 'on' : ''}" aria-pressed=${s.filter === id}
            @click=${() => act.set({ filter: id })}>${text}</button>`)}
      </div>
      <div class="shelf">
        ${byMeeting(entries).map(([num, group]) => html`<div class="slot">
          <div class="row">
            ${group.map((e) => html`<button class="cov" style="--ring:${e.album.cardColor}"
              aria-label=${label(e.album)} aria-current=${e.album.id === s.selId ? 'true' : 'false'}
              ?data-dim=${!matches(s.filter, e, recent)} @click=${() => act.select(e.album.id)}>
              ${e.album.coverUrl ? html`<img src=${textureUrl(e.album.coverUrl, 256)} alt="" loading="lazy">` : nothing}
            </button>`)}
          </div>
          <div class="muted small">Møde ${num}</div>
        </div>`)}
      </div>
    </section>`
}
