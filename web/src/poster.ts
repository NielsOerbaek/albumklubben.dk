import { html, nothing, type TemplateResult } from 'lit-html'
import { formatMeetingDate } from '../../shared/dates.ts'
import type { Album, Meeting, Poster } from '../../shared/types.ts'
import './poster.css'

const label = (a: Album) => `${a.artist}, ${a.title}`
const paragraphs = (text: string | null) =>
  (text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

export interface PosterOptions {
  poster: Poster
  meeting: Meeting
  onAlbum: (a: Album) => void
  onClose: () => void
}

/** A poster held up over the page: the full image, its video, the meeting and its albums.
 *  The backdrop closes it, like the album dialog, but not with the second click of the double
 *  click that may have opened it. */
export function posterDialog(o: PosterOptions): TemplateResult {
  const { poster, meeting } = o
  const date = formatMeetingDate(meeting.date, meeting.time)
  const about = paragraphs(poster.about)
  return html`<div class="poster-dialog" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget && e.detail < 2) o.onClose() }}>
    <div class="poster-dialog-inner">
      <div class="poster-dialog-bar">
        <button class="poster-close" aria-label="Luk" @click=${o.onClose}>×</button>
      </div>
      <div class="poster-view">
        <div class="poster-media ${poster.videoUrl ? 'has-video' : ''}">
          <img class="poster-image" src=${poster.imageUrl} alt=${poster.caption ?? `Plakat til møde ${meeting.number}`}>
          ${poster.videoUrl ? html`<video class="poster-video" src=${poster.videoUrl} controls playsinline preload="metadata"></video>` : nothing}
        </div>
        <div class="poster-text">
          <div class="poster-meta">
            <h3>Møde ${meeting.number}</h3>
            ${date ? html`<p class="poster-date">${date}</p>` : nothing}
            ${meeting.theme ? html`<p class="poster-theme">${meeting.theme}</p>` : nothing}
            ${poster.caption ? html`<p class="poster-caption"><em>${poster.caption}</em></p>` : nothing}
          </div>
          ${about.length ? html`<div class="poster-about">${about.map((p) => html`<p>${p}</p>`)}</div>` : nothing}
          ${meeting.albums.length ? html`<section class="poster-albums">
            <h4>Albums fra mødet</h4>
            <ul>${meeting.albums.map((a) => html`<li><button aria-label=${label(a)} title=${label(a)} @click=${() => o.onAlbum(a)}>
              ${a.coverUrl ? html`<img src=${a.coverUrl} alt="">` : html`<span class="poster-nocover">${a.artist}<br>${a.title}</span>`}
            </button></li>`)}</ul>
          </section>` : nothing}
        </div>
      </div>
    </div>
  </div>`
}
