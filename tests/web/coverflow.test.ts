// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from 'lit-html'
import { CENTRE_GAP, SIDE_STEP, coverPose, coverflowView } from '../../web/src/arkiv/coverflow.ts'
import type { Actions, Entry, State } from '../../web/src/arkiv/main.ts'
import type { Album } from '../../shared/types.ts'

test('the centre cover faces you', () => {
  expect(coverPose(0)).toEqual({ x: 0, z: 0, rotateY: 0, zIndex: 1000 })
})

test('side covers turn towards the centre and stack tightly', () => {
  expect(coverPose(1).rotateY).toBe(-70)
  expect(coverPose(-1).rotateY).toBe(70)
  expect(coverPose(1).x).toBe(CENTRE_GAP)
  expect(coverPose(3).x).toBe(CENTRE_GAP + 2 * SIDE_STEP)
  expect(coverPose(-3).x).toBe(-coverPose(3).x)
  expect(coverPose(1).z).toBe(coverPose(-5).z)
  expect(coverPose(1).z).toBeLessThan(0)
})

test('zIndex falls with the distance from the centre', () => {
  for (let i = 0; i < 20; i++) {
    expect(coverPose(i + 1).zIndex).toBeLessThan(coverPose(i).zIndex)
    expect(coverPose(-i - 1).zIndex).toBeLessThan(coverPose(-i).zIndex)
  }
})

const album = (i: number, patch: Partial<Album> = {}): Album => ({ id: i + 1, meetingId: 1, position: i % 2,
  artist: `Kunstner ${i + 1}`, title: `Album ${i + 1}`, year: 1990 + i, origin: '', country: 'USA', lat: null,
  lng: null, genre: 'Rock', gender: 'Mand', status: 'Aktiv', pickedByName: null, pickedByWorkplace: null,
  story: null, cardColor: '#262d66', coverUrl: `/uploads/covers/${i + 1}.jpg`, tracklist: null, ...patch })

/** 44 albums, two per meeting, oldest first; every fifth one (ids 5, 10, ... 40) is Danish. */
const archive = (danish = (id: number) => id % 5 === 0): Entry[] =>
  Array.from({ length: 44 }, (_, i) => ({ album: album(i, danish(i + 1) ? { country: 'Danmark' } : {}),
    n: Math.floor(i / 2) + 1 }))

function mount(entries: Entry[]) {
  const s: State = { entries, selId: entries.at(-1)!.album.id, showTracks: false,
    filter: 'alle', mapView: 'world', dialogId: null, dialogTracks: false }
  const d = document.createElement('div')
  document.body.append(d)
  const draw = () => render(coverflowView(s, act), d)
  const act: Actions = {
    select(id) { Object.assign(s, { selId: id, showTracks: false }); draw() },
    surprise() {},
    set(patch) { Object.assign(s, patch); draw() },
  }
  draw()
  const centre = () => d.querySelector('.cf-cover[aria-current="true"]')?.getAttribute('aria-label')
  const covers = () => [...d.querySelectorAll('.cf-cover')].map((c) => c.getAttribute('aria-label'))
  const chip = (text: string) => [...d.querySelectorAll<HTMLButtonElement>('.chips .pill')]
    .find((b) => b.textContent!.trim() === text)!
  return { s, d, centre, covers, chip }
}

test('draws at most 31 covers and opens on the newest album', () => {
  const { d, centre } = mount(archive())
  expect(d.querySelectorAll('.cf-cover').length).toBeLessThanOrEqual(31)
  expect(d.querySelectorAll('.cf-cover').length).toBeGreaterThan(10)
  expect(centre()).toBe('Kunstner 44, Album 44')
  expect(d.querySelector('.cf-caption')!.textContent).toContain('Album 44')
})

test('ArrowLeft on the band moves one album back', () => {
  const { d, centre } = mount(archive())
  d.querySelector('.cf-band')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(centre()).toBe('Kunstner 43, Album 43')
  d.querySelector('.cf-band')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(centre()).toBe('Kunstner 44, Album 44')
})

test('clicking a side cover centres it', () => {
  const { d, centre } = mount(archive())
  const side = [...d.querySelectorAll<HTMLButtonElement>('.cf-cover')].find((c) => c.getAttribute('aria-label') === 'Kunstner 40, Album 40')!
  side.click()
  expect(centre()).toBe('Kunstner 40, Album 40')
})

test('the Danske filter narrows the carousel and selects the newest match', () => {
  const { s, centre, covers, chip } = mount(archive())
  chip('Danske').click()
  expect(s.filter).toBe('dk')
  expect(covers()).toEqual([5, 10, 15, 20, 25, 30, 35, 40].map((i) => `Kunstner ${i}, Album ${i}`))
  expect(centre()).toBe('Kunstner 40, Album 40')
})

test('the Danske filter keeps the selection when it is Danish', () => {
  const { s, d, centre, chip } = mount(archive())
  const band = d.querySelector('.cf-band')!
  for (let i = 0; i < 9; i++) band.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(centre()).toBe('Kunstner 35, Album 35')
  chip('Danske').click()
  expect(s.selId).toBe(35)
  expect(centre()).toBe('Kunstner 35, Album 35')
})

test('a filter with no matches says so and draws no carousel', () => {
  const { d, chip } = mount(archive(() => false))
  chip('Danske').click()
  expect(d.textContent).toContain('Ingen albums passer til filteret.')
  expect(d.querySelector('.cf-band')).toBeNull()
  expect(d.querySelector('.cf-cover')).toBeNull()
})

test('the centred album is shown below the band', () => {
  const { d } = mount(archive())
  expect(d.querySelector('.album-view')!.textContent).toContain('Kunstner 44, Album 44')
})

test('arrow keys still work when a clicked cover has focus, and the slider keeps its own keys', () => {
  const { d, centre } = mount(archive())
  const cover = [...d.querySelectorAll<HTMLButtonElement>('.cf-cover')].find((c) => c.getAttribute('aria-label') === 'Kunstner 40, Album 40')!
  cover.click()
  cover.focus()
  cover.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(centre()).toBe('Kunstner 39, Album 39')
  d.querySelector('.cf-slider')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(centre()).toBe('Kunstner 39, Album 39')
})
