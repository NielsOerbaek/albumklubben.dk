import { html, nothing, type TemplateResult } from 'lit-html'
import './start.css'
import { festTracks, type FestSummary, type FestView } from '../../../shared/lyttefest.ts'
import type { Album } from '../../../shared/types.ts'

/**
 * Starting a lyttefest from an album, and the ones that album has already had. The same panel
 * goes under the album in Arkivet and in Klubhuset.
 *
 * The time is read as the browser's own, which for this club is Copenhagen.
 */
const MIN_MINUTES = 10

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time. */
function localValue(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`
}

const whenText = (iso: string) => new Date(iso).toLocaleString('da-DK', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
})

export interface LyttefestPanel {
  /** The section to put under an album in its dialog. */
  template(album: Album): TemplateResult
  /** Called when a dialog opens on an album: fetches what that album has had. */
  open(albumId: number): void
}

export function createLyttefestPanel(onChange: () => void): LyttefestPanel {
  let albumId: number | null = null
  let list: FestSummary[] = []
  let form = false
  let when = ''
  let note = ''
  let sending = false
  let error: string | null = null

  async function fetchList(id: number) {
    try {
      const res = await fetch(`/api/albums/${id}/lyttefester`, { headers: { accept: 'application/json' } })
      if (!res.ok) return
      if (albumId === id) { list = await res.json() as FestSummary[]; onChange() }
    } catch { /* the album is readable without its lyttefester */ }
  }

  async function start(album: Album) {
    if (sending || !when) return
    sending = true
    error = null
    onChange()
    try {
      const res = await fetch('/api/lyttefest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ albumId: album.id, startsAt: new Date(when).toISOString(), note: note.trim() || undefined }),
      })
      const body = await res.json().catch(() => null) as FestView & { error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? 'Lyttefesten kunne ikke laves')
      location.href = `/lyttefest/${body!.id}`
      return
    } catch (err) {
      error = (err as Error).message
    }
    sending = false
    onChange()
  }

  const soon = () => localValue(new Date(Date.now() + (MIN_MINUTES + 1) * 60_000))

  return {
    open(id) {
      albumId = id
      list = []
      form = false
      when = ''
      note = ''
      error = null
      void fetchList(id)
    },

    template(album) {
      const playable = festTracks(album.tracklist) !== null
      return html`<section class="fest-start">
        <h3>Lyttefest</h3>
        ${list.length ? html`<ul class="fest-start-list">
          ${list.map(f => html`<li>
            <a href=${`/lyttefest/${f.id}`}>${whenText(f.startsAt)}</a>
            <span class="fest-start-by">${f.cancelled ? 'aflyst' : `${f.host.name}, ${f.coming} kommer`}</span>
          </li>`)}
        </ul>` : nothing}
        ${form ? html`
          <form class="fest-start-form" @submit=${(e: Event) => { e.preventDefault(); void start(album) }}>
            <label>Hvornår
              <input type="datetime-local" .value=${when} min=${soon()}
                @input=${(e: Event) => { when = (e.target as HTMLInputElement).value; onChange() }}>
            </label>
            <label>En besked (kan udelades)
              <input type="text" maxlength="280" .value=${note}
                @input=${(e: Event) => { note = (e.target as HTMLInputElement).value }}>
            </label>
            ${error ? html`<p class="fest-start-error">${error}</p>` : nothing}
            <div class="fest-start-bar">
              <button class="pill" type="button" @click=${() => { form = false; error = null; onChange() }}>Fortryd</button>
              <button class="pill" type="submit" ?disabled=${sending || !when}>
                ${sending ? 'Laver …' : 'Slå lyttefesten op'}</button>
            </div>
            <p class="fest-start-note">Lyttefesten slås op i klubbens gruppe på Theta, som dig.</p>
          </form>`
          : html`<button class="pill" ?disabled=${!playable}
              title=${playable ? nothing : 'Kræver en tracklist med spilletider'}
              @click=${() => {
                form = true
                when ||= localValue(new Date(Date.now() + 30 * 60_000))
                onChange()
              }}>Start en lyttefest</button>
            ${playable ? nothing : html`<p class="fest-start-note">Kræver en tracklist med spilletider.</p>`}`}
      </section>`
    },
  }
}
