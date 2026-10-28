// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from 'lit-html'
import { columns, headline, shareLabel, statsView, type Dimension } from '../../web/src/arkiv/stats.ts'
import type { Actions, Entry, State } from '../../web/src/arkiv/main.ts'
import type { Album } from '../../shared/types.ts'
import { toLineup } from '../../shared/gender.ts'

const album = (i: number, patch: Partial<Album> = {}): Album => ({ id: i + 1, meetingId: 1, position: i % 2,
  artist: `Kunstner ${i + 1}`, title: `Album ${i + 1}`, year: 1960 + i, origin: '', country: ['USA', 'Danmark', 'UK', ''][i % 4],
  lat: null, lng: null, genre: 'Rock', status: 'Aktiv',
  lineup: toLineup([{ men: 1 }, { women: 1 }, {}, { men: 4 }][i % 4]),
  pickedByName: i % 5 === 0 ? 'Mette' : null, pickedByWorkplace: null, story: null, cardColor: '#262d66',
  coverUrl: `/uploads/covers/${i + 1}.jpg`, tracklist: null, ...patch })
const entries: Entry[] = Array.from({ length: 44 }, (_, i) => ({ album: album(i, i === 3 ? { year: null } : {}), n: Math.floor(i / 2) + 1 }))

test('shareLabel gives count and rounded percentage', () => {
  expect(shareLabel(10, 44)).toBe('10 albums · 23%')
  expect(shareLabel(1, 44)).toBe('1 album · 2%')
})

test('every dimension but Køn counts each album exactly once', () => {
  for (const dim of ['decade', 'genre', 'country'] as Dimension[])
    expect(columns(dim, entries).reduce((n, c) => n + c.items.length, 0)).toBe(44)
})

test('gender is a few columns, in the same order whatever the data', () => {
  const cols = columns('gender', entries)
  // The fixture is men, women and blanks; a column nobody is in is not drawn.
  expect(cols.map((c) => c.label)).toEqual(['Mænd', 'Kvinder', 'Andet'])
})

test('an album nobody has counted yet stands under Andet, not nowhere', () => {
  const cols = columns('gender', [{ album: album(0, { lineup: toLineup({}) }), n: 1 }])
  expect(cols.map((c) => c.label)).toEqual(['Andet'])
  expect(cols[0].items).toHaveLength(1)
})

test('an album with more than one gender in the band stands in every one of their columns', () => {
  const band: Entry[] = [{ album: album(0, { lineup: toLineup({ men: 5, women: 1 }) }), n: 1 }]
  const cols = columns('gender', band)
  expect(cols.map((c) => c.label)).toEqual(['Mænd', 'Kvinder'])
  // One cover a member, so the height of the bar is the people in it and not the albums.
  expect(cols[0].items).toHaveLength(5)
  expect(cols[1].items).toHaveLength(1)
  expect(cols.every((c) => c.items.every((i) => i.entry.album.id === band[0].album.id))).toBe(true)
})

test('each of a band\'s covers says which member it stands for; a soloist\'s says nothing', () => {
  const [men, women] = columns('gender', [{ album: album(0, { lineup: toLineup({ men: 3, women: 1 }) }), n: 1 }])
  expect(men.items.map((i) => i.member)).toEqual([{ i: 1, of: 3 }, { i: 2, of: 3 }, { i: 3, of: 3 }])
  expect(women.items[0].member).toBeUndefined()
})

test('a gender column counts people first, not a share that would add up past the whole', () => {
  const [men] = columns('gender', [
    { album: album(0, { lineup: toLineup({ men: 4 }) }), n: 1 },
    { album: album(1, { lineup: toLineup({ men: 1 }) }), n: 1 },
  ])
  expect(men.label).toBe('Mænd')
  expect(men.items).toHaveLength(5)
  expect(men.sub).toBe('5 personer · 2 albums')
})

test('headline numbers', () => {
  expect(headline(entries, 22)).toEqual([
    { label: 'Albums', value: 44 }, { label: 'Møder', value: 22 }, { label: 'Lande', value: 3 },
    { label: 'Nostalgialbums', value: 9 }])
})

test('four rows with shares; a tile opens the dialog', () => {
  const s: State = { entries, selId: 1, showTracks: false, filter: 'alle', mapView: 'world', dialogId: null, dialogTracks: false }
  const d = document.createElement('div')
  document.body.append(d)
  const draw = () => render(statsView(s, act), d)
  const act: Actions = { select() {}, surprise() {}, set(p) { Object.assign(s, p); draw() } }
  draw()
  expect(d.querySelectorAll('.colrow').length).toBe(4)
  for (const section of d.querySelectorAll('.columns')) {
    // Every column says how big it is: a share of the whole, except Køn, where an album can be
    // in two columns at once and the shares would add up past it.
    const want = section.querySelector('.dim')!.textContent === 'Køn' ? 'personer' : '%'
    for (const l of section.querySelectorAll('.clabel')) expect(l.textContent).toContain(want)
  }
  d.querySelector<HTMLButtonElement>('.tile')!.click()
  expect(s.dialogId).not.toBeNull()
  expect(s.selId).toBe(1)
})

const drawOne = (lineup: ReturnType<typeof toLineup>) => {
  const s: State = { entries: [{ album: album(0, { lineup }), n: 1 }], selId: 1, showTracks: false,
    filter: 'alle', mapView: 'world', dialogId: null, dialogTracks: false }
  const d = document.createElement('div')
  render(statsView(s, { select() {}, surprise() {}, set() {} }), d)
  return [...d.querySelectorAll('.columns')].at(-1)! // Køn is the last of the four
}

test('a band of four is drawn four covers high, each saying which member it is', () => {
  const koen = drawOne(toLineup({ men: 4 }))
  const tiles = [...koen.querySelectorAll('.tile')]
  expect(tiles).toHaveLength(4)
  expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([
    'Kunstner 1, Album 1 (1 af 4)', 'Kunstner 1, Album 1 (2 af 4)',
    'Kunstner 1, Album 1 (3 af 4)', 'Kunstner 1, Album 1 (4 af 4)'])
  expect(koen.querySelector('.clabel')!.textContent).toContain('4 personer · 1 album')
})

test('a soloist is drawn once, and named without a number', () => {
  const koen = drawOne(toLineup({ men: 1 }))
  expect(koen.querySelectorAll('.tile')).toHaveLength(1)
  expect(koen.querySelector('.tile')!.getAttribute('aria-label')).toBe('Kunstner 1, Album 1')
})
