import { describe, expect, it } from 'vitest'
import { firstName, formatPostTime } from '../../shared/board.ts'

describe('opslagstavlens tider og navne', () => {
  const now = new Date(2026, 9, 27, 14, 30) // 27. oktober 2026, kl. 14.30

  it('shows the clock for today, the day before as "i går", and the date before that', () => {
    expect(formatPostTime(new Date(2026, 9, 27, 9, 5).toISOString(), now)).toBe('09.05')
    expect(formatPostTime(new Date(2026, 9, 26, 23, 59).toISOString(), now)).toBe('I går 23.59')
    expect(formatPostTime(new Date(2026, 9, 3, 8, 0).toISOString(), now)).toBe('3. okt. 08.00')
  })

  it('writes the year only when it is not this one', () => {
    expect(formatPostTime(new Date(2025, 11, 24, 18, 0).toISOString(), now)).toBe('24. dec. 2025 18.00')
  })

  it('gives nothing for a time it cannot read', () => {
    expect(formatPostTime('', now)).toBe('')
    expect(formatPostTime('i tirsdags', now)).toBe('')
  })

  it('takes the first name, and falls back when there is none', () => {
    expect(firstName('Niels Ørbæk Chemnitz')).toBe('Niels')
    expect(firstName('  Kim  ')).toBe('Kim')
    expect(firstName('')).toBe('Et medlem')
  })
})
