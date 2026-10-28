import { describe, expect, it } from 'vitest'
import { readGender } from '../../tools/gender-to-lineup.ts'
import { EMPTY_LINEUP } from '../../shared/gender.ts'

/**
 * The one-off that turned the club's old free-text `gender` lines into counts. Nothing reads
 * prose at run time any more; this is kept, and tested, because it is the record of how the
 * numbers in the database were arrived at — and because the Figma export still has the old field.
 */
const band = (over: Partial<typeof EMPTY_LINEUP> = {}) => ({ ...EMPTY_LINEUP, ...over })

describe('at læse de gamle køns-linjer', () => {
  it('reads one person', () => {
    expect(readGender('Mand')).toEqual(band({ men: 1 }))
    expect(readGender('Kvinde')).toEqual(band({ women: 1 }))
    expect(readGender('Nonbinær')).toEqual(band({ nonbinary: 1 }))
  })

  it('counts a trans woman as a woman and a trans man as a man', () => {
    expect(readGender('Transkvinde')).toEqual(band({ women: 1 }))
    expect(readGender('Transmand')).toEqual(band({ men: 1 }))
  })

  it('reads a number, in digits or written out', () => {
    expect(readGender('4 mænd')).toEqual(band({ men: 4 }))
    expect(readGender('Tre kvinder')).toEqual(band({ women: 3 }))
    expect(readGender('Syv mænd')).toEqual(band({ men: 7 }))
  })

  it('reads a band of more than one gender, however it is punctuated', () => {
    expect(readGender('5 mænd og 1 kvinde')).toEqual(band({ men: 5, women: 1 }))
    expect(readGender('3 kvinder, 2 mænd')).toEqual(band({ women: 3, men: 2 }))
    expect(readGender('1 mand og 1 kvinde')).toEqual(band({ men: 1, women: 1 }))
  })

  it('takes the reading that names the most genders when the card offers a choice', () => {
    // The one album in the club's data that did this: Gorillaz, the band and the virtual band.
    expect(readGender('3 mænd eller 2 mænd, 1 kvinde og 1 nonbinær (det virtuelle band)'))
      .toEqual(band({ men: 2, women: 1, nonbinary: 1 }))
  })

  it('puts a line it cannot read, and an empty one, under Andet', () => {
    expect(readGender('')).toEqual(band({ other: 1 }))
    expect(readGender('Ukendt')).toEqual(band({ other: 1 }))
    expect(readGender('Et kollektiv')).toEqual(band({ other: 1 }))
  })

  it('never counts somebody as less than one of themselves', () => {
    expect(readGender('0 mænd')).toEqual(band({ men: 1 }))
  })
})
