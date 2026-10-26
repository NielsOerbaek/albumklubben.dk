import type { Album, Meeting, Poster } from '../../shared/types.ts'

type Fields = Record<string, string>
type Errors = Record<string, string>

export const escapeHtml = (s: string | number | null | undefined): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const e = escapeHtml

export function layout(title: string, body: string, flash?: string): string {
  return `<!doctype html>
<html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(title)} | Albumklubben</title>
<link rel="stylesheet" href="/admin/admin.css"><script src="/admin/admin.js" defer></script></head>
<body>
<header><a href="/admin">Albumklubben · Redigering</a>
<form method="post" action="/admin/logout"><button type="submit" class="link">Log ud</button></form></header>
<main>${flash ? `<p class="flash">${e(flash)}</p>` : ''}${body}</main>
</body></html>`
}

const fieldError = (errors: Errors, k: string) => (errors[k] ? `<span class="error">${e(errors[k])}</span>` : '')
const formError = (errors: Errors) => (errors.form ? `<p class="error">${e(errors.form)}</p>` : '')

function input(label: string, name: string, v: Fields, errors: Errors, attrs = '', type = 'text') {
  return `<label>${e(label)} <input type="${type}" name="${name}" value="${e(v[name])}" ${attrs}>${fieldError(errors, name)}</label>`
}

export function meetingsPage(meetings: Meeting[], flash?: string): string {
  const rows = [...meetings].sort((a, b) => b.number - a.number).map(m =>
    `<tr><td><a href="/admin/meetings/${m.id}">Møde ${m.number}</a></td><td>${e(m.date)}</td><td>${e(m.theme)}</td>
<td>${m.albums.length} album${m.albums.length === 1 ? '' : 's'}, ${m.posters.length} plakat${m.posters.length === 1 ? '' : 'er'}</td></tr>`).join('')
  return layout('Møder', `<h1>Møder</h1><p><a class="button" href="/admin/meetings/new">Nyt møde</a></p>
<table><thead><tr><th>Møde</th><th>Dato</th><th>Tema</th><th>Indhold</th></tr></thead><tbody>${rows}</tbody></table>`, flash)
}

const meetingFields = (v: Fields, errors: Errors) => `${formError(errors)}
${input('Mødenummer', 'number', v, errors, 'required inputmode="numeric"')}
${input('Dato', 'date', v, errors, '', 'date')}
${input('Tidspunkt', 'time', v, errors, 'placeholder="11:30"')}
${input('Tema', 'theme', v, errors)}`

export function newMeetingPage(v: Fields = {}, errors: Errors = {}): string {
  return layout('Nyt møde', `<h1>Nyt møde</h1>
<form method="post" action="/admin/meetings/new">${meetingFields(v, errors)}<button type="submit">Opret</button></form>`)
}

const thumb = (url: string | null, alt: string) => (url ? `<img class="thumb" src="${e(url)}" alt="${e(alt)}">` : '')

function mover(base: string, id: number) {
  return ['up', 'down'].map(dir => `<form method="post" action="${base}/${id}/move" class="inline">
<input type="hidden" name="dir" value="${dir}"><button type="submit">${dir === 'up' ? 'Op' : 'Ned'}</button></form>`).join('')
}

const deleteForm = (action: string) => `<form method="post" action="${action}" class="inline"
onsubmit="return confirm('Er du sikker på at du vil slette?')"><button type="submit" class="danger">Slet</button></form>`

function albumItem(a: Album) {
  return `<li>${thumb(a.coverUrl, '')}<span><strong>${e(a.artist)}</strong>, ${e(a.title)}${a.year ? ` (${a.year})` : ''}</span>
<a href="/admin/albums/${a.id}">Rediger</a>${mover('/admin/albums', a.id)}${deleteForm(`/admin/albums/${a.id}/delete`)}</li>`
}

function posterItem(p: Poster) {
  return `<li>${thumb(p.imageUrl, '')}<span>${e(p.caption) || 'Uden billedtekst'}${p.videoUrl ? ' (med video)' : ''}</span>
<a href="/admin/posters/${p.id}">Rediger</a>${mover('/admin/posters', p.id)}${deleteForm(`/admin/posters/${p.id}/delete`)}</li>`
}

export function meetingPage(m: Meeting, v: Fields, errors: Errors = {}, flash?: string): string {
  return layout(`Møde ${m.number}`, `<h1>Møde ${m.number}</h1>
<form method="post" action="/admin/meetings/${m.id}">${meetingFields(v, errors)}<button type="submit">Gem</button></form>
<h2>Album</h2>
<ul class="items">${m.albums.map(albumItem).join('')}</ul>
<p><a class="button" href="/admin/meetings/${m.id}/albums/new">Nyt album</a></p>
<h2>Plakater</h2>
<ul class="items">${m.posters.map(posterItem).join('')}</ul>
<p><a class="button" href="/admin/meetings/${m.id}/posters/new">Ny plakat</a></p>
<h2>Slet møde</h2>
<form method="post" action="/admin/meetings/${m.id}/delete" class="danger-zone">
<p>Sletter mødet med alle album, plakater og filer. Det kan ikke fortrydes.</p>
<label><input type="checkbox" name="confirm" value="ja" required> Ja, slet mødet</label>
<button type="submit" class="danger">Slet møde</button></form>`, flash)
}

export function albumForm(
  meeting: Meeting, action: string, v: Fields, errors: Errors, coverUrl: string | null, isNew: boolean,
): string {
  const t = (label: string, name: string, attrs = '') => input(label, name, v, errors, attrs)
  return layout(isNew ? 'Nyt album' : 'Rediger album', `<h1>${isNew ? 'Nyt album' : 'Rediger album'}, møde ${meeting.number}</h1>
<form method="post" action="${action}" enctype="multipart/form-data">
${formError(errors)}
${t('Kunstner', 'artist', 'required')}
${t('Titel', 'title', 'required')}
${t('År', 'year', 'inputmode="numeric" maxlength="4"')}
${t('Kunstners oprindelsesland', 'origin', 'placeholder="England, London"')}
${t('Land (til globus og kort)', 'country')}
${t('Breddegrad', 'lat', 'inputmode="decimal"')}
${t('Længdegrad', 'lng', 'inputmode="decimal"')}
<details><summary>Hvordan finder jeg breddegrad og længdegrad?</summary>
<p>Søg stedet op i Google Maps, højreklik på det og klik på tallene øverst i menuen. Det første tal er breddegrad, det andet længdegrad. Udfyld begge eller ingen af dem.</p></details>
${t('Genre', 'genre')}
${t('Køn', 'gender')}
${t('Status', 'status')}
${t('Valgt af', 'picked_by_name')}
${t('Arbejdsplads', 'picked_by_workplace')}
<label>Historie <textarea name="story" rows="6">${e(v.story)}</textarea></label>
<label>Tracklist <textarea name="tracklist" rows="12">${e(v.tracklist)}</textarea>
<span class="hint">Ét nummer pr. linje, eventuelt med spilletid til sidst (Windowlicker 6:07). En tom linje starter en ny disk.</span></label>
<p><button type="button" data-musicbrainz>Hent fra MusicBrainz</button> <span data-musicbrainz-status role="status"></span></p>
<label>Kortfarve <input type="color" name="card_color" value="${e(v.card_color || '#302c21')}">${fieldError(errors, 'card_color')}</label>
<label>Cover ${thumb(coverUrl, 'Nuværende cover')} <input type="file" name="cover" accept="image/jpeg,image/png,image/webp">
<span class="hint">${isNew ? 'jpg, png eller webp' : 'Vælg en fil for at skifte cover'}</span>${fieldError(errors, 'cover')}</label>
<button type="submit">Gem</button> <a href="/admin/meetings/${meeting.id}">Annuller</a>
</form>`)
}

export function posterForm(
  meeting: Meeting, action: string, v: Fields, errors: Errors, poster: Poster | null,
): string {
  return layout(poster ? 'Rediger plakat' : 'Ny plakat', `<h1>${poster ? 'Rediger plakat' : 'Ny plakat'}, møde ${meeting.number}</h1>
<form method="post" action="${action}" enctype="multipart/form-data">
${formError(errors)}
<label>Billede ${poster ? thumb(poster.imageUrl, 'Nuværende billede') : ''}
<input type="file" name="image" accept="image/jpeg,image/png,image/webp" ${poster ? '' : 'required'}>${fieldError(errors, 'image')}</label>
${input('Billedtekst', 'caption', v, errors)}
<label>Om plakaten <textarea name="about" rows="6">${e(v.about)}</textarea></label>
<label>Video (mp4 eller webm) <input type="file" name="video" accept="video/mp4,video/webm">
<span class="hint">Videoen skal være mp4 (H.264) eller webm. Videoer fra iPhone (.mov, HEVC) skal først eksporteres eller konverteres.</span>${fieldError(errors, 'video')}</label>
${poster?.videoUrl ? `<p>Nuværende video: <a href="${e(poster.videoUrl)}">se video</a></p>
<label><input type="checkbox" name="remove_video" value="ja"> Fjern videoen</label>` : ''}
<button type="submit">Gem</button> <a href="/admin/meetings/${meeting.id}">Annuller</a>
</form>`)
}

export const notFoundPage = () => layout('Ikke fundet', '<h1>Ikke fundet</h1><p><a href="/admin">Til oversigten</a></p>')
