import { html, nothing, type TemplateResult } from 'lit-html'
import { cardTemplate, storyTemplate } from '../card.ts'
import { textureUrl } from '../api.ts'
import { mapAspect, project, type MapView } from '../../../shared/projection.ts'
import type { Actions, Entry, State } from './main.ts'

const VIEWS: [MapView, string][] = [['world', 'Verden'], ['denmark', 'Danmark']]
const SPACING = 26 // px between pins that share a spot

const label = (a: { artist: string; title: string }) => `${a.artist}, ${a.title}`
/** Albums within the same half degree count as one spot and fan out. */
const spotKey = (e: Entry) => `${Math.round(e.album.lat! * 2)},${Math.round(e.album.lng! * 2)}`

function pins(s: State, open: (e: Entry) => void) {
  const placed = s.entries.filter((e) => e.album.lat != null && e.album.lng != null)
  const groups = new Map<string, Entry[]>()
  for (const e of placed) groups.set(spotKey(e), [...(groups.get(spotKey(e)) ?? []), e])
  let hidden = 0
  const out = placed.flatMap((e) => {
    const pos = project(s.mapView, e.album.lat!, e.album.lng!)
    if (!pos) { hidden++; return [] }
    const group = groups.get(spotKey(e))!
    const dx = (group.indexOf(e) - (group.length - 1) / 2) * SPACING
    const sel = e.album.id === s.selId && s.panelOpen
    return [html`<button class="pin ${sel ? 'sel' : ''}" aria-label=${label(e.album)} title=${label(e.album)}
      style="left:calc(${pos.x}% + ${dx}px);top:${pos.y}%;--ring:${e.album.cardColor}"
      @click=${() => open(e)}>
      ${e.album.coverUrl ? html`<img src=${textureUrl(e.album.coverUrl, 128)} alt="">` : nothing}
    </button>`]
  })
  return { out, hidden }
}

export function mapView(s: State, act: Actions): TemplateResult {
  const open = (e: Entry) => act.set({ selId: e.album.id, flipped: false, panelOpen: true })
  const { out, hidden } = pins(s, open)
  const unplaced = s.entries.filter((e) => e.album.lat == null || e.album.lng == null)
  const sel = s.entries.find((e) => e.album.id === s.selId)
  const same = sel?.album.country
    ? s.entries.filter((e) => e.album.country === sel.album.country && e !== sel).length
    : 0

  return html`<main class="atlas ${s.panelOpen && sel ? 'with-panel' : ''}">
    <section class="mapcol">
      <div class="chips">
        ${VIEWS.map(([id, text]) =>
          html`<button class="pill ${s.mapView === id ? 'on' : ''}" aria-pressed=${s.mapView === id}
            @click=${() => act.set({ mapView: id })}>${text}</button>`)}
      </div>
      <div class="mapbox" style="--aspect:${mapAspect(s.mapView)}">
        <img class="basemap" src="/maps/${s.mapView}.svg" alt="">
        ${out}
      </div>
      <p class="muted small">Klik på et cover. Byerne er omtrentlige.${hidden
        ? ` ${hidden === 1 ? '1 album ligger' : `${hidden} albums ligger`} uden for dette kort.` : ''}</p>
      ${unplaced.length
        ? html`<div class="unplaced"><h2>Uden sted</h2>
            <div class="row">${unplaced.map((e) => html`<button class="cov small-cov" style="--ring:${e.album.cardColor}"
              aria-label=${label(e.album)} title=${label(e.album)} @click=${() => open(e)}>
              ${e.album.coverUrl ? html`<img src=${textureUrl(e.album.coverUrl, 128)} alt="">` : nothing}
            </button>`)}</div></div>`
        : nothing}
    </section>
    ${s.panelOpen && sel
      ? html`<aside class="panel">
          <button class="close" aria-label="Luk" @click=${() => act.set({ panelOpen: false })}>×</button>
          ${cardTemplate(sel.album, sel.n)}
          ${storyTemplate(sel.album)}
          ${sel.album.country
            ? html`<p class="muted small">${same ? `${plural(same)} fra ${sel.album.country}` : `Det eneste album fra ${sel.album.country}`}</p>`
            : nothing}
        </aside>`
      : nothing}
  </main>`
}

const plural = (n: number) => (n === 1 ? '1 andet album' : `${n} andre albums`)
