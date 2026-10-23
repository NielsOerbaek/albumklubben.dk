import type { Meeting } from './types.ts'

/** The highest-numbered meeting that has at least one album. */
export function latestMeetingWithAlbums(meetings: Meeting[]): Meeting | undefined {
  return meetings.reduce<Meeting | undefined>(
    (best, m) => (m.albums.length && (!best || m.number > best.number) ? m : best), undefined)
}
