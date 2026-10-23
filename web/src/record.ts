import { html, type TemplateResult } from 'lit-html'
import { cardTemplate, inkFor, storyTemplate } from './card.ts'
import type { Album } from '../../shared/types.ts'
import './record.css'

/** A record held up large over a 3D view: the cover, or the card when `flipped`, with the story
 *  below. Clicking the record turns it; clicking the backdrop closes. */
export function recordOverlay(opts: {
  album: Album
  meetingNumber: number
  flipped: boolean
  help: string
  onTurn: () => void
  onClose: () => void
}): TemplateResult {
  const { album, meetingNumber: n, flipped } = opts
  return html`<div class="record-pull" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) opts.onClose() }}>
    <div class="record-pull-inner">
      <p class="record-pull-kicker">Møde ${n} · ${album.artist}, ${album.title}</p>
      <button class="record ${flipped ? 'is-card' : 'is-cover'}" aria-pressed=${flipped} style="--card-bg:${album.cardColor};color:${inkFor(album.cardColor)}" @click=${opts.onTurn}>
        ${flipped
          ? cardTemplate(album, n)
          : album.coverUrl
            ? html`<img src=${album.coverUrl} alt=${`${album.artist}, ${album.title}`}>`
            : html`<span class="record-nocover">${album.artist}<br>${album.title}</span>`}
      </button>
      ${storyTemplate(album)}
      <p class="record-pull-help">${opts.help}</p>
    </div>
  </div>`
}
