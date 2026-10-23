import { describe, expect, it } from 'vitest'
import { latestMeetingWithAlbums } from '../../shared/latest.ts'
import type { Meeting } from '../../shared/types.ts'

const meeting = (number: number, albums: number): Meeting =>
  ({ id: number, number, albums: Array(albums).fill({}), posters: [] }) as unknown as Meeting

describe('latestMeetingWithAlbums', () => {
  it('picks the highest number with at least one album, whatever the order', () => {
    const ms = [meeting(5, 2), meeting(23, 0), meeting(9, 1), meeting(7, 3)]
    expect(latestMeetingWithAlbums(ms)?.number).toBe(9)
  })
  it('is undefined when no meeting has albums', () => {
    expect(latestMeetingWithAlbums([meeting(1, 0)])).toBeUndefined()
    expect(latestMeetingWithAlbums([])).toBeUndefined()
  })
})
