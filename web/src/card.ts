import { html, nothing, type TemplateResult } from 'lit-html'
import type { Album } from '../../shared/types.ts'
import './card.css'

export function inkFor(hex: string): '#121316' | '#ffffff' {
  const n = parseInt(hex.replace('#', ''), 16)
  const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return luma > 150 ? '#121316' : '#ffffff'
}

const row = (label: string, value: string) =>
  value ? html`<p><strong>${label}</strong> ${value}</p>` : nothing

export function cardTemplate(album: Album, meetingNumber: number): TemplateResult {
  const origin = [album.country, album.origin].filter(Boolean).join(', ')
  const title = `${album.artist}, ${album.title}${album.year != null ? ` (${album.year})` : ''}`
  const pick = album.pickedByName
    ? `Valgt af ${[album.pickedByName, album.pickedByWorkplace].filter(Boolean).join(', ')}`
    : ''
  return html`<article class="album-card"
    style="--card-bg:${album.cardColor};--card-ink:${inkFor(album.cardColor)}">
    <h3>MØDE ${meetingNumber}</h3>
    <p class="album-title"><em>${title}</em></p>
    <div class="album-facts">
      ${row('Kunstners oprindelsesland:', origin)}
      ${row('Genre:', album.genre)}
      ${row('Køn:', album.gender)}
      ${row('Status:', album.status)}
    </div>
    ${pick ? html`<p class="album-pick"><strong>Nostalgialbum:</strong> ${pick}</p>` : nothing}
  </article>`
}

export function storyTemplate(album: Album): TemplateResult | typeof nothing {
  return album.story ? html`<blockquote class="album-story">${album.story}</blockquote>` : nothing
}
