// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from 'lit-html'
import { columns, headline, shareLabel, statsView, type Dimension } from '../../web/src/arkiv/stats.ts'
import type { Actions, Entry, State } from '../../web/src/arkiv/main.ts'
import type { Album } from '../../shared/types.ts'

const album = (i: number, patch: Partial<Album> = {}): Album => ({ id: i + 1, meetingId: 1, position: i % 2,
  artist: `Kunstner ${i + 1}`, title: `Album ${i + 1}`, year: 1960 + i, origin: '', country: ['USA', 'Danmark', 'UK', ''][i % 4],
  lat: null, lng: null, genre: 'Rock', gender: ['Mand', 'Kvinde', ' ', 'Mand'][i % 4], status: 'Aktiv',
  pickedByName: i % 5 === 0 ? 'Mette' : null, pickedByWorkplace: null, story: null, cardColor: '#262d66',
  coverUrl: `/uploads/covers/${i + 1}.jpg`, tracklist: null, ...patch })
const entries: Entry[] = Array.from({ length: 44 }, (_, i) => ({ album: album(i, i === 3 ? { year: null } : {}), n: Math.floor(i / 2) + 1 }))

test('shareLabel gives count and rounded percentage', () => {
  expect(shareLabel(10, 44)).toBe('10 albums · 23%')
  expect(shareLabel(1, 44)).toBe('1 album · 2%')
})

test('every dimension counts each album exactly once', () => {
  for (const dim of ['decade', 'genre', 'country', 'gender'] as Dimension[])
    expect(columns(dim, entries).reduce((n, c) => n + c.items.length, 0)).toBe(44)
})

test('gender groups by trimmed text with Ukendt last', () => {
  const cols = columns('gender', entries)
  expect(cols.map((c) => c.label)).toEqual(['Mand', 'Kvinde', 'Ukendt'])
})

test('headline numbers', () => {
  expect(headline(entries, 22)).toEqual([
    { label: 'Albums', value: 44 }, { label: 'Møder', value: 22 }, { label: 'Lande', value: 3 },
    { label: 'Nostalgialbums', value: 9 }])
})

test('four rows with shares; a tile opens the dialog', () => {
  const s: State = { entries, latest: 22, selId: 1, showTracks: false, filter: 'alle', mapView: 'world', dialogId: null, dialogTracks: false }
  const d = document.createElement('div')
  document.body.append(d)
  const draw = () => render(statsView(s, act), d)
  const act: Actions = { select() {}, surprise() {}, set(p) { Object.assign(s, p); draw() } }
  draw()
  expect(d.querySelectorAll('.colrow').length).toBe(4)
  for (const l of d.querySelectorAll('.clabel')) expect(l.textContent).toContain('%')
  d.querySelector<HTMLButtonElement>('.tile')!.click()
  expect(s.dialogId).not.toBeNull()
  expect(s.selId).toBe(1)
})
