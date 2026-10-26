import { html, nothing, type TemplateResult } from 'lit-html'
import { formatMeetingDate } from '../../../shared/dates.ts'
import { latestMeetingWithAlbums } from '../../../shared/latest.ts'
import type { Meeting } from '../../../shared/types.ts'
import { thumbUrl } from '../api.ts'
import './next.css'

export type NextLabel = 'Næste møde' | 'Seneste møde'
export interface NextPick { meeting: Meeting; label: NextLabel }

/** The meeting the front page introduces: the earliest one from today on, or else the latest with
 *  albums, which is still "next" while its date is unknown (its albums are chosen ahead). */
export function nextMeeting(meetings: Meeting[], today: string): NextPick | null {
  const upcoming = meetings.filter((m) => m.date && m.date >= today)
    .sort((a, b) => a.date!.localeCompare(b.date!))[0]
  if (upcoming) return { meeting: upcoming, label: 'Næste møde' }
  const latest = latestMeetingWithAlbums(meetings)
  if (!latest) return null
  return { meeting: latest, label: latest.date && latest.date < today ? 'Seneste møde' : 'Næste møde' }
}

/** Today in Copenhagen as YYYY-MM-DD. */
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date())

const STANDING = 'Hver anden tirsdag 11.30-12.30 på Thoravej 29'

const enter = html`<a class="next-enter" href="/klubhuset">Gå ind i Klubhuset <span aria-hidden="true">→</span></a>`

export interface NextActions { album(id: number): void; poster(id: number): void }

/** The intro band at the top of the front page: the meeting, its albums and posters, and the way in. */
export function nextView(pick: NextPick | null, on: NextActions): TemplateResult {
  if (!pick) return html`<section class="next"><p class="next-kicker">Albumklubben</p>
    <p class="next-intro">Albumklubben lytter til to albums hver anden tirsdag på Thoravej 29.</p>
    ${enter}</section>`
  const { meeting: m, label } = pick
  const date = formatMeetingDate(m.date, m.time)
  return html`<section class="next" aria-label=${label}>
    <div class="next-text">
      <p class="next-kicker">${label}</p>
      <h1>Møde ${m.number}</h1>
      <p class="next-date">${date ?? STANDING}</p>
      ${m.theme ? html`<p class="next-theme">${m.theme}</p>` : nothing}
      <p class="next-intro">${date
        ? 'Albumklubben lytter til to albums hver anden tirsdag på Thoravej 29.'
        : 'Albumklubben lytter til to albums sammen i frokostpausen.'}</p>
    </div>
    <ul class="next-albums">${m.albums.map((a) => html`<li>
      <button class="next-album" @click=${() => on.album(a.id)} aria-label="${a.artist}, ${a.title}">
        ${a.coverUrl
          ? html`<img src=${thumbUrl(a.coverUrl, 512)} alt="">`
          : html`<span class="next-nocover">${a.artist}<br>${a.title}</span>`}
      </button>
      <p class="next-artist">${a.artist}</p>
      <p class="next-title">${a.title}</p>
    </li>`)}</ul>
    ${m.posters.length ? html`<div class="next-posters"><h2>Plakater</h2><ul>${m.posters.map((p) => html`<li>
      <button class="next-poster" @click=${() => on.poster(p.id)} aria-label=${p.caption ?? `Plakat til møde ${m.number}`}>
        <img src=${thumbUrl(p.imageUrl, 512)} alt="">
      </button></li>`)}</ul></div>` : nothing}
    ${enter}
  </section>`
}
