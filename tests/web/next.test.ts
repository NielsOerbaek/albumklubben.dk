// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { render } from 'lit-html'
import { nextMeeting, nextView } from '../../web/src/arkiv/next.ts'
import type { Album, Meeting, Poster } from '../../shared/types.ts'

const album = (id: number, artist = `A${id}`, title = `T${id}`) =>
  ({ id, artist, title, coverUrl: `/uploads/c${id}.jpg` }) as Album
const meeting = (number: number, date: string | null, albums: Album[] = [], posters: Poster[] = []): Meeting =>
  ({ id: number, number, date, time: date ? '11:30-12:30' : null, theme: null, albums, posters })
const TODAY = '2026-10-26'

describe('nextMeeting', () => {
  test('no meetings gives null', () => {
    expect(nextMeeting([], TODAY)).toBeNull()
  })

  test('picks the earliest meeting from today on as Næste møde', () => {
    const ms = [meeting(1, '2026-10-01', [album(1)]), meeting(3, '2026-11-09'), meeting(2, TODAY)]
    expect(nextMeeting(ms, TODAY)).toEqual({ meeting: ms[2], label: 'Næste møde' })
  })

  test('without upcoming dates, the latest meeting with albums before today is Seneste møde', () => {
    const ms = [meeting(1, '2026-09-01', [album(1)]), meeting(2, '2026-09-15', [album(2)]), meeting(3, '2026-09-29')]
    expect(nextMeeting(ms, TODAY)).toEqual({ meeting: ms[1], label: 'Seneste møde' })
  })

  test('the latest meeting with albums and no date is Næste møde', () => {
    const ms = [meeting(18, '2026-09-01', [album(1)]), meeting(22, null, [album(2)]), meeting(21, null, [album(3)])]
    expect(nextMeeting(ms, TODAY)).toEqual({ meeting: ms[1], label: 'Næste møde' })
  })

  test('meetings without albums or upcoming dates give null', () => {
    expect(nextMeeting([meeting(1, '2026-01-01'), meeting(2, null)], TODAY)).toBeNull()
  })
})

describe('nextView', () => {
  const draw = (t: unknown) => { const d = document.createElement('div'); render(t as never, d); return d }
  const poster = { id: 7, meetingId: 22, position: 0, imageUrl: '/uploads/p.jpg', caption: null, about: null, videoUrl: null }

  test('shows the meeting with the standing line when the date is unknown, and wires the clicks', () => {
    const on = { album: vi.fn(), poster: vi.fn() }
    const m = { ...meeting(22, null, [album(1, 'Air', 'Moon Safari'), album(2)], [poster]), theme: 'Nostalgialbums' }
    const d = draw(nextView({ meeting: m, label: 'Næste møde' }, on))
    expect(d.querySelector('.next-kicker')?.textContent).toBe('Næste møde')
    expect(d.querySelector('h1')?.textContent).toBe('Møde 22')
    expect(d.querySelector('.next-date')?.textContent).toBe('Hver anden tirsdag 11.30-12.30 på Thoravej 29')
    expect(d.querySelector('.next-theme')?.textContent).toBe('Nostalgialbums')
    expect(d.querySelector('.next-intro')?.textContent).not.toContain('Thoravej')
    expect(d.querySelector('.next-artist')?.textContent).toBe('Air')
    expect(d.querySelector('.next-album img')?.getAttribute('src')).toBe('/thumb/512/c1.jpg')
    ;(d.querySelector('.next-album') as HTMLButtonElement).click()
    expect(on.album).toHaveBeenCalledWith(1)
    ;(d.querySelector('.next-poster') as HTMLButtonElement).click()
    expect(on.poster).toHaveBeenCalledWith(7)
    expect(d.querySelector('a.next-enter')?.getAttribute('href')).toBe('/klubhuset')
  })

  test('shows a known date and no poster row without posters', () => {
    const d = draw(nextView({ meeting: meeting(18, '2026-09-01', [album(1)]), label: 'Seneste møde' },
      { album() {}, poster() {} }))
    expect(d.querySelector('.next-date')?.textContent).toBe('Tirsdag 1. september 2026, 11.30-12.30')
    expect(d.querySelector('.next-posters')).toBeNull()
    expect(d.querySelector('.next-theme')).toBeNull()
  })
})
