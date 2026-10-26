import { describe, expect, it } from 'vitest'
import { formatTracklist, parseTracklist } from '../../shared/tracklist.ts'

describe('tracklist', () => {
  it('parses discs, durations and CRLF', () => {
    expect(parseTracklist('A 3:45\r\nB\n\n\nC 1:02:03\n')).toEqual([
      [{ title: 'A', length: '3:45' }, { title: 'B', length: null }],
      [{ title: 'C', length: '1:02:03' }],
    ])
  })
  it('returns [] for null or blank', () => {
    expect(parseTracklist(null)).toEqual([])
    expect(parseTracklist('  ')).toEqual([])
  })
  it('does not treat a bare number as a duration', () => {
    expect(parseTracklist('Song 2')).toEqual([[{ title: 'Song 2', length: null }]])
  })
  it('format is stable on a second round', () => {
    const once = formatTracklist(parseTracklist('A 3:45\r\nB\n\n\nC 1:02:03\n'))
    expect(once).toBe('A 3:45\nB\n\nC 1:02:03')
    expect(formatTracklist(parseTracklist(once))).toBe(once)
  })
})
