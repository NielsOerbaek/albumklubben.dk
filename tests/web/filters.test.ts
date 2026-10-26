import { expect, test } from 'vitest'
import { matches, recentLabel, recentYears } from '../../web/src/arkiv/filters.ts'
import type { Entry } from '../../web/src/arkiv/main.ts'
import type { Album } from '../../shared/types.ts'

const base: Album = { id: 1, meetingId: 1, position: 0, artist: 'A', title: 'T', year: 2001, origin: '',
  country: 'USA', lat: null, lng: null, genre: '', gender: '', status: '', pickedByName: null,
  pickedByWorkplace: null, story: null, cardColor: '#000000', coverUrl: null, tracklist: null }
const entry = (patch: Partial<Album>): Entry => ({ album: { ...base, ...patch }, n: 1 })

test('recentYears gives the two newest years, newest first, skipping missing years', () => {
  const es = [entry({ year: 1999 }), entry({ year: 2024 }), entry({ year: null }), entry({ year: 2025 }), entry({ year: 2024 })]
  expect(recentYears(es)).toEqual([2025, 2024])
  expect(recentYears([entry({ year: 2010 })])).toEqual([2010])
  expect(recentYears([entry({ year: null })])).toEqual([])
})

test('recentLabel', () => {
  expect(recentLabel([2025, 2024])).toBe('2024-25')
  expect(recentLabel([2025, 2020])).toBe('2020 og 2025')
  expect(recentLabel([2025])).toBe('2025')
})

test('matches each filter', () => {
  const recent = [2025, 2024]
  expect(matches('alle', entry({}), recent)).toBe(true)
  expect(matches('nostalgi', entry({ pickedByName: 'Medlem 9' }), recent)).toBe(true)
  expect(matches('nostalgi', entry({}), recent)).toBe(false)
  expect(matches('dk', entry({ country: 'Danmark' }), recent)).toBe(true)
  expect(matches('dk', entry({}), recent)).toBe(false)
  expect(matches('old', entry({ year: 1999 }), recent)).toBe(true)
  expect(matches('old', entry({ year: 2000 }), recent)).toBe(false)
  expect(matches('old', entry({ year: null }), recent)).toBe(false)
  expect(matches('recent', entry({ year: 2024 }), recent)).toBe(true)
  expect(matches('recent', entry({ year: 2023 }), recent)).toBe(false)
  expect(matches('recent', entry({ year: null }), recent)).toBe(false)
})
