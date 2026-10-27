import { html, nothing, type TemplateResult } from 'lit-html'
import { parseTracklist } from '../../shared/tracklist.ts'
import type { Album } from '../../shared/types.ts'
import './album.css'

export function inkFor(hex: string): '#121316' | '#ffffff' {
  const n = parseInt(hex.replace('#', ''), 16)
  const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return luma > 150 ? '#121316' : '#ffffff'
}

const row = (label: string, value: string) =>
  value ? html`<p><strong>${label}</strong> ${value}</p>` : nothing

const label = (a: Album) => `${a.artist}, ${a.title}`

function infoTemplate(album: Album, meetingNumber: number): TemplateResult {
  // `origin` is the full card text and already starts with the country.
  const origin = album.origin || album.country
  const title = `${label(album)}${album.year != null ? ` (${album.year})` : ''}`
  const pick = album.pickedByName
    ? `Valgt af ${[album.pickedByName, album.pickedByWorkplace].filter(Boolean).join(', ')}`
    : ''
  return html`<aside class="album-info" style="--card-bg:${album.cardColor};--card-ink:${inkFor(album.cardColor)}">
    <h3>MØDE ${meetingNumber}</h3>
    <p class="album-title"><em>${title}</em></p>
    <div class="album-facts">
      ${row('Kunstners oprindelsesland:', origin)}
      ${row('Genre:', album.genre)}
      ${row('Køn:', album.gender)}
      ${row('Status:', album.status)}
    </div>
    ${pick ? html`<p class="album-pick"><strong>Nostalgialbum:</strong> ${pick}</p>` : nothing}
    ${album.story ? html`<blockquote class="album-story">${album.story}</blockquote>` : nothing}
  </aside>`
}

/** The back of the record: the tracklist on the album's colour. */
function tracksTemplate(album: Album): TemplateResult {
  const discs = parseTracklist(album.tracklist)
  const count = discs.reduce((n, d) => n + d.length, 0)
  return html`<div class="tracks ${count > 14 ? 'cols-2' : ''} ${count > 24 ? 'dense' : ''} ${count > 36 ? 'cols-3' : ''}"
    style="--card-bg:${album.cardColor};--card-ink:${inkFor(album.cardColor)}">
    <p class="tracks-head">${label(album)}</p>
    <div class="tracks-body">
      ${discs.map((disc, d) => html`<section class="disc">
        ${discs.length > 1 ? html`<h4>Disk ${d + 1}</h4>` : nothing}
        <ol>${disc.map((t, i) => html`<li><span class="no">${i + 1}</span> <span class="name">${t.title}</span> <span class="len">${t.length ?? ''}</span></li>`)}</ol>
      </section>`)}
    </div>
  </div>`
}

export interface AlbumOptions {
  album: Album
  meetingNumber: number
  showTracks: boolean
  onToggle: () => void
  size?: 'large' | 'medium'
  /** Put under the album in its dialog: the lyttefest panel, where there is one. */
  extra?: TemplateResult
}

/** The record (cover, turning to the tracklist) with the info panel beside it. */
export function albumTemplate(o: AlbumOptions): TemplateResult {
  const { album } = o
  const has = parseTracklist(album.tracklist).length > 0
  const turned = has && o.showTracks
  return html`<div class="album-view ${o.size ?? 'large'}">
    <div class="album-record">
      <button class="record ${turned ? 'is-turned' : ''}" ?disabled=${!has} aria-pressed=${turned}
        aria-label=${turned ? 'Vis cover' : has ? 'Vis tracklist' : label(album)} @click=${o.onToggle}>
        <span class="record-inner">
          <span class="record-front">${album.coverUrl
            ? html`<img src=${album.coverUrl} alt=${label(album)}>`
            : html`<span class="record-nocover">${album.artist}<br>${album.title}</span>`}</span>
          ${has ? html`<span class="record-back">${tracksTemplate(album)}</span>` : nothing}
        </span>
      </button>
      ${has ? html`<button class="pill" @click=${o.onToggle}>${turned ? 'Vis cover' : 'Vis tracklist'}</button>` : nothing}
    </div>
    ${infoTemplate(album, o.meetingNumber)}
  </div>`
}

/** An album held up over the page: a backdrop that closes when clicked, but not with the second
 *  click of the double click that may have opened it. */
export function albumDialog(o: AlbumOptions & { help?: string; onClose: () => void; onBack?: () => void }): TemplateResult {
  return html`<div class="album-dialog" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget && e.detail < 2) o.onClose() }}>
    <div class="album-dialog-inner">
      <div class="album-dialog-bar">
        ${o.onBack ? html`<button class="pill album-back" @click=${o.onBack}>← Tilbage</button>` : nothing}
        <button class="album-close" aria-label="Luk" @click=${o.onClose}>×</button>
      </div>
      ${albumTemplate(o)}
      ${o.extra ?? nothing}
      ${o.help ? html`<p class="album-help">${o.help}</p>` : nothing}
    </div>
  </div>`
}
