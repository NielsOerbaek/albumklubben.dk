// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from 'lit-html'
import { posterDialog } from '../../web/src/poster.ts'
import type { Album, Meeting, Poster } from '../../shared/types.ts'

const album = (id: number, artist: string, title: string, coverUrl: string | null): Album => ({ id, meetingId: 4,
  position: id, artist, title, year: 2001, origin: '', country: '', lat: null, lng: null, genre: '', gender: '',
  status: '', pickedByName: null, pickedByWorkplace: null, story: null, cardColor: '#262d66', coverUrl, tracklist: null })

const poster: Poster = { id: 9, meetingId: 4, position: 0, imageUrl: '/uploads/posters/9.png', caption: 'Forårsmødet',
  about: 'Tegnet af Ida.\n\nTrykt i 40 eksemplarer.', videoUrl: '/uploads/videos/9.mp4' }
const albums = [album(1, 'Aphex Twin', 'Drukqs', '/uploads/covers/1.jpg'), album(2, 'Björk', 'Vespertine', null)]
const meeting: Meeting = { id: 4, number: 12, date: '2026-04-21', time: '11:30-12:30', theme: 'Elektronisk forår',
  albums, posters: [poster] }

const draw = (o: Partial<Parameters<typeof posterDialog>[0]> = {}) => {
  const d = document.createElement('div')
  render(posterDialog({ poster, meeting, onAlbum: () => {}, onClose: () => {}, ...o }), d)
  return d
}
const text = (d: Element) => d.textContent!.replace(/\s+/g, ' ')

test('shows every field', () => {
  const d = draw()
  expect(d.querySelector('.poster-dialog')).not.toBeNull()
  expect(d.querySelector<HTMLImageElement>('.poster-dialog img.poster-image')!.getAttribute('src')).toBe('/uploads/posters/9.png')
  const video = d.querySelector('video')!
  expect(video.getAttribute('src')).toBe('/uploads/videos/9.mp4')
  expect(video.hasAttribute('controls')).toBe(true)
  expect(video.hasAttribute('playsinline')).toBe(true)
  const t = text(d)
  for (const s of ['Møde 12', 'Tirsdag 21. april 2026, 11.30-12.30', 'Elektronisk forår', 'Forårsmødet', 'Albums fra mødet']) {
    expect(t).toContain(s)
  }
  const paras = [...d.querySelectorAll('.poster-about p')].map((p) => p.textContent)
  expect(paras).toEqual(['Tegnet af Ida.', 'Trykt i 40 eksemplarer.'])
  expect(d.querySelectorAll('.poster-albums button').length).toBe(2)
})

test('missing fields leave no trace', () => {
  const bare = { ...poster, about: null, caption: null, videoUrl: null }
  const d = draw({ poster: bare, meeting: { ...meeting, theme: null, date: null, time: '11:30', albums: [] } })
  const t = text(d)
  expect(t).not.toMatch(/null|undefined|11/)
  expect(t).toContain('Møde 12')
  expect(d.querySelector('video')).toBeNull()
  expect(d.querySelector('.poster-about')).toBeNull()
  expect(t).not.toContain('Albums fra mødet')
  for (const h of d.querySelectorAll('h2, h3, h4, p')) expect(h.textContent!.trim()).not.toBe('')
})

test('a cover opens its album', () => {
  const picked: Album[] = []
  const d = draw({ onAlbum: (a) => picked.push(a) })
  const buttons = d.querySelectorAll<HTMLButtonElement>('.poster-albums button')
  buttons[1].click()
  expect(picked).toEqual([albums[1]])
  expect(buttons[0].querySelector('img')!.getAttribute('src')).toBe('/uploads/covers/1.jpg')
  expect(buttons[1].getAttribute('aria-label')).toBe('Björk, Vespertine')
})

test('the close button and the backdrop close it', () => {
  let n = 0
  const d = draw({ onClose: () => n++ })
  d.querySelector<HTMLButtonElement>('.poster-close')!.click()
  d.querySelector<HTMLElement>('.poster-dialog')!.click()
  d.querySelector<HTMLElement>('.poster-meta')!.click()
  expect(n).toBe(2)
  // The second click of the double click that opened it lands on the backdrop.
  d.querySelector('.poster-dialog')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  expect(n).toBe(2)
})

test('the about text is text, not markup', () => {
  const d = draw({ poster: { ...poster, about: 'Med <b>fed</b> skrift' } })
  expect(d.querySelector('.poster-about b')).toBeNull()
  expect(d.querySelector('.poster-about')!.textContent).toContain('<b>fed</b>')
})
