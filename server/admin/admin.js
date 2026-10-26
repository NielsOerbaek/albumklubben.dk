document.addEventListener('click', async event => {
  const button = event.target.closest('[data-musicbrainz]')
  if (!button) return
  const form = button.form
  const status = form.querySelector('[data-musicbrainz-status]')
  const area = form.elements.tracklist
  const artist = form.elements.artist.value.trim()
  const title = form.elements.title.value.trim()
  if (!artist || !title) { status.textContent = 'Udfyld kunstner og titel først.'; return }
  if (area.value.trim() && !confirm('Erstat den tracklist, der står der nu?')) return
  button.disabled = true
  status.textContent = 'Henter ...'
  try {
    const res = await fetch('/admin/musicbrainz?' + new URLSearchParams({ artist, title }))
    if (res.redirected || !(res.headers.get('content-type') || '').includes('json')) {
      status.textContent = 'Du er logget ud. Log ind igen og prøv igen.'
      return
    }
    const body = await res.json()
    if (!res.ok) { status.textContent = body.error || 'Noget gik galt.'; return }
    area.value = body.tracklist
    status.textContent = 'Hentet: ' + body.release
  } catch {
    status.textContent = 'MusicBrainz svarer ikke lige nu. Prøv igen om lidt.'
  } finally {
    button.disabled = false
  }
})
