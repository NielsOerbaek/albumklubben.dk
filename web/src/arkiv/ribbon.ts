import { html, nothing, type TemplateResult } from 'lit-html'
import { thumbUrl } from '../api.ts'
import { formatCountdown, formatWhen, type FestBrief } from '../../../shared/lyttefest.ts'
import './ribbon.css'

/**
 * The lyttefest ribbon: a fat band across the top of the front page, under the header and over
 * the section pills, for a lyttefest playing now or still to come.
 *
 * A lyttefest is the one thing on this site that is over if you miss it, and the front page said
 * nothing about one until you went looking. It is on the album's colour, so it reads as the album
 * it is for, and the whole band is the way in to it.
 *
 * Nothing is drawn when there is none, which is most of the time — an empty ribbon would be a
 * standing piece of furniture saying nothing.
 */
const MAX = 3 // more than three coming up is a list, not a ribbon

/** "Nu" while it plays, else the countdown and the time it starts. */
function whenText(f: FestBrief, now: number): string {
  if (f.state === 'nu') {
    return f.track ? `Spiller nu · ${f.trackNumber}. ${f.track}` : 'Spiller nu'
  }
  const seconds = Math.max(0, (Date.parse(f.startsAt) - now) / 1000)
  return `Starter ${formatCountdown(seconds)} · ${formatWhen(f.startsAt)}`
}

function oneTemplate(f: FestBrief, now: number): TemplateResult {
  const cover = f.coverUrl ? thumbUrl(f.coverUrl, 256) : null
  return html`<a class="ribbon ${f.state === 'nu' ? 'is-now' : ''}" href=${`/lyttefest/${f.id}`}>
    ${cover ? html`<img class="ribbon-cover" src=${cover} alt="" loading="lazy">` : nothing}
    <span class="ribbon-text">
      <span class="ribbon-kicker">${f.state === 'nu' ? 'Lyttefest nu' : 'Lyttefest'}</span>
      <span class="ribbon-album">${f.artist} – ${f.title}</span>
      <span class="ribbon-when">${whenText(f, now)}</span>
    </span>
    <span class="ribbon-go" aria-hidden="true">→</span>
  </a>`
}

/** The band, or nothing at all. `now` is the clock, so a test can decide what time it is. */
export function ribbonView(fests: FestBrief[], now = Date.now()): TemplateResult | typeof nothing {
  const show = fests.filter(f => f.state === 'nu' || f.state === 'kommende').slice(0, MAX)
  if (show.length === 0) return nothing
  return html`<div class="ribbons">${show.map(f => oneTemplate(f, now))}</div>`
}
