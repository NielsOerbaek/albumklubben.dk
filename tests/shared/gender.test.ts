import { describe, expect, it } from 'vitest'
import { describeLineup, EMPTY_LINEUP, lineupTotal, LINEUP_KEYS, toLineup } from '../../shared/gender.ts'

const band = (over: Partial<typeof EMPTY_LINEUP> = {}) => ({ ...EMPTY_LINEUP, ...over })

describe('en besætning', () => {
  it('counts everybody in it', () => {
    expect(lineupTotal(band({ men: 5, women: 1 }))).toBe(6)
    expect(lineupTotal(EMPTY_LINEUP)).toBe(0)
  })

  it('writes itself out for the album\'s card', () => {
    expect(describeLineup(band({ men: 5, women: 1 }))).toBe('5 mænd, 1 kvinde')
    expect(describeLineup(band({ women: 1 }))).toBe('1 kvinde')
    expect(describeLineup(band({ men: 1 }))).toBe('1 mand')
    expect(describeLineup(band({ nonbinary: 2 }))).toBe('2 nonbinære')
  })

  it('writes itself out in the order the bars stand in, whatever order it was given', () => {
    expect(describeLineup(band({ other: 1, women: 2, men: 3 }))).toBe('3 mænd, 2 kvinder, 1 anden')
  })

  it('says nothing at all when nobody was counted', () => {
    expect(describeLineup(EMPTY_LINEUP)).toBe('')
  })
})

describe('at læse en besætning ind', () => {
  it('takes the four counts', () => {
    expect(toLineup({ men: 5, women: 1, nonbinary: 0, other: 0 })).toEqual(band({ men: 5, women: 1 }))
  })

  it('reads what is missing as nobody, so an old record still loads', () => {
    expect(toLineup({ men: 2 })).toEqual(band({ men: 2 }))
    expect(toLineup({})).toEqual(EMPTY_LINEUP)
    expect(toLineup(undefined)).toEqual(EMPTY_LINEUP)
    expect(toLineup(null)).toEqual(EMPTY_LINEUP)
  })

  it('refuses a count that is not a whole number of people', () => {
    expect(toLineup({ men: -3, women: 'to', nonbinary: 1.7, other: NaN }))
      .toEqual(band({ nonbinary: 1 }))
  })

  it('has a label for every key, so no bar can go unnamed', () => {
    expect(LINEUP_KEYS).toEqual(['men', 'women', 'nonbinary', 'other'])
    for (const key of LINEUP_KEYS) expect(describeLineup(band({ [key]: 1 }))).not.toBe('')
  })
})
