import { describe, expect, it } from 'vitest'
import { wrap } from '../../web/src/klubhus/corkboard.ts'

describe('a note on the cork board', () => {
  it('breaks between words and folds to the board\'s own type', () => {
    expect(wrap('Nyt møde på tirsdag', 12, 3)).toEqual(['NYT MØDE PÅ', 'TIRSDAG'])
  })

  it('cuts a word that is longer than the note is wide', () => {
    expect(wrap('Rekommanderetbrev', 12, 3)).toEqual(['REKOMMANDERE'])
  })

  it('stops at the last line it has room for, and says there is more', () => {
    const lines = wrap('en to tre fire fem seks syv otte ni ti elleve tolv', 12, 3)
    expect(lines).toHaveLength(3)
    expect(lines.at(-1)!.endsWith('...')).toBe(true)
    expect(lines.every((l) => l.length <= 12)).toBe(true)
  })

  it('does not say there is more when there is not', () => {
    expect(wrap('Kort', 12, 3)).toEqual(['KORT'])
    expect(wrap('en to tre', 12, 3)).toEqual(['EN TO TRE'])
  })

  it('is empty for an empty note', () => {
    expect(wrap('   ', 12, 3)).toEqual([])
  })
})
