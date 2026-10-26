// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from 'lit-html'
import { albumDialog, albumTemplate, inkFor } from '../../web/src/album.ts'
import type { Album } from '../../shared/types.ts'

const drukqs: Album = { id: 1, meetingId: 1, position: 0, artist: 'Aphex Twin', title: 'Drukqs', year: 2001,
  origin: 'Storbritannien, Cornwall', country: 'Storbritannien', lat: null, lng: null, genre: 'IDM',
  gender: 'Mand', status: 'Aktiv', pickedByName: 'Medlem 9', pickedByWorkplace: 'Arbejdsplads B',
  story: 'En stemme.', cardColor: '#262d66', coverUrl: null, tracklist: null }

const draw = (t: unknown) => { const d = document.createElement('div'); render(t as never, d); return d }
const view = (album: Album, showTracks = false, onToggle = () => {}) =>
  draw(albumTemplate({ album, meetingNumber: 6, showTracks, onToggle }))
const text = (d: Element) => d.textContent!.replace(/\s+/g, ' ')

test('inkFor picks readable text', () => {
  expect(inkFor('#262d66')).toBe('#ffffff')
  expect(inkFor('#ccc1b4')).toBe('#121316')
})

test('the panel shows the card content', () => {
  const t = text(view(drukqs))
  for (const s of ['MØDE 6', 'Aphex Twin, Drukqs (2001)', 'Kunstners oprindelsesland: Storbritannien, Cornwall',
    'Genre: IDM', 'Køn: Mand', 'Status: Aktiv', 'Nostalgialbum: Valgt af Medlem 9, Arbejdsplads B', 'En stemme.']) {
    expect(t).toContain(s)
  }
})

test('no null or undefined for missing fields', () => {
  const t = text(view({ ...drukqs, year: null, pickedByName: null, story: null }))
  expect(t).not.toMatch(/null|undefined/)
  expect(t).not.toContain('Nostalgialbum')
  expect(t).not.toContain('(')
})

test('the pill turns the record', () => {
  const a = { ...drukqs, tracklist: 'A 1:00\nB' }
  let n = 0
  const front = view(a, false, () => n++)
  const pill = front.querySelector<HTMLButtonElement>('.pill')!
  expect(pill.textContent).toBe('Vis tracklist')
  pill.click()
  front.querySelector<HTMLButtonElement>('.record')!.click()
  expect(n).toBe(2)
  const back = view(a, true)
  expect(back.querySelector('.pill')!.textContent).toBe('Vis cover')
  expect(back.querySelector('.record')!.classList.contains('is-turned')).toBe(true)
  const t = text(back.querySelector('.record-back')!)
  expect(t).toContain('1 A 1:00')
  expect(t).toContain('2 B')
})

test('no tracklist: no pill, disabled record, no back', () => {
  const d = view(drukqs)
  expect(d.querySelector('.pill')).toBeNull()
  expect(d.querySelector<HTMLButtonElement>('.record')!.disabled).toBe(true)
  expect(d.querySelector('.record-back')).toBeNull()
})

test('long tracklists use two columns and disc headings', () => {
  const disc = (n: number) => Array.from({ length: n }, (_, i) => `T${i} 1:00`).join('\n')
  const d = view({ ...drukqs, tracklist: `${disc(15)}\n\n${disc(15)}` }, true)
  expect(d.querySelector('.cols-2.dense')).not.toBeNull()
  expect(text(d)).toContain('Disk 1')
  expect(text(d)).toContain('Disk 2')
  const one = view({ ...drukqs, tracklist: disc(5) }, true)
  expect(one.querySelector('.cols-2')).toBeNull()
  expect(text(one)).not.toContain('Disk')
})

test('hostile story stays text', () => {
  const d = view({ ...drukqs, story: '<script>x</script>' })
  expect(d.querySelector('script')).toBeNull()
  expect(d.textContent).toContain('<script>x</script>')
})

test('dialog: close, back and backdrop', () => {
  const calls: string[] = []
  const d = draw(albumDialog({ album: drukqs, meetingNumber: 6, showTracks: false, onToggle() {},
    help: 'Esc', onClose: () => calls.push('close'), onBack: () => calls.push('back') }))
  const root = d.querySelector<HTMLElement>('.album-dialog')!
  d.querySelector<HTMLButtonElement>('.album-close')!.click()
  d.querySelector<HTMLButtonElement>('.album-back')!.click()
  root.click()
  d.querySelector<HTMLElement>('.album-view')!.click()
  expect(calls).toEqual(['close', 'back', 'close'])
  expect(d.textContent).toContain('← Tilbage')
  const none = draw(albumDialog({ album: drukqs, meetingNumber: 6, showTracks: false, onToggle() {}, onClose() {} }))
  expect(none.querySelector('.album-back')).toBeNull()
})
