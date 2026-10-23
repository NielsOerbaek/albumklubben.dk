import { html, render, nothing } from 'lit-html'
import './base.css'
import { topBarTemplate } from './topbar.ts'
import './landing.css'
import { fetchArchive, textureUrl } from './api.ts'
import { latestMeetingWithAlbums } from '../../shared/latest.ts'
import type { Archive } from '../../shared/types.ts'

function view(archive: Archive | null) {
  const meetings = archive?.meetings ?? []
  const covers = meetings.flatMap((m) => m.albums).flatMap((a) => (a.coverUrl ? [a.coverUrl] : []))
  const latest = latestMeetingWithAlbums(meetings)
  const latestAlbums = latest?.albums.filter((a) => a.coverUrl) ?? []
  return html`${topBarTemplate(null)}
    <div class="hero">
    <div class="mosaic" aria-hidden="true">
      ${covers.map((c) => html`<img src=${textureUrl(c, 256)} alt="" loading="lazy">`)}
    </div>
    <div class="side-mark" aria-hidden="true">Albumklubben</div>
    <header>
      <h1>Albumklubben lytter til to albums hver anden tirsdag på Thoravej 29.</h1>
      <p>Hver anden tirsdag 11.30-12.30</p>
    </header>
    <nav class="entries">
      <a href="/crate">Crate digging <span aria-hidden="true">→</span></a>
      <a href="/museum">Albumklubben Museum <span aria-hidden="true">→</span></a>
      <a href="/arkiv">Arkivet <span aria-hidden="true">→</span></a>
    </nav>
    ${latest && latestAlbums.length
      ? html`<footer class="latest">
          ${latestAlbums.map((a) => html`<img src=${textureUrl(a.coverUrl!, 256)} alt="${a.artist}, ${a.title}">`)}
          <div><strong>Seneste møde</strong>Møde ${latest.number}</div>
        </footer>`
      : nothing}
  </div>`
}

const app = document.getElementById('app')!
render(view(null), app)
fetchArchive().then((a) => render(view(a), app), () => {})
