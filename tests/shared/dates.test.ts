import { describe, expect, it } from 'vitest'
import { formatMeetingDate } from '../../shared/dates.ts'

describe('formatMeetingDate', () => {
  it('gives the Danish weekday, date and time', () => {
    expect(formatMeetingDate('2026-04-21', '11:30-12:30')).toBe('Tirsdag 21. april 2026, 11.30-12.30')
  })
  it('leaves the time out when unknown', () => {
    expect(formatMeetingDate('2026-04-21', null)).toBe('Tirsdag 21. april 2026')
    expect(formatMeetingDate('2025-12-07', '')).toBe('Søndag 7. december 2025')
  })
  it('shows no time without a date', () => {
    expect(formatMeetingDate(null, '11:30')).toBeNull()
    expect(formatMeetingDate(null, null)).toBeNull()
  })
  it('gives null for an invalid date', () => {
    for (const d of ['', 'snart', '2026-02-30', '2026-13-01', '21-04-2026']) expect(formatMeetingDate(d, '11:30')).toBeNull()
  })
})
