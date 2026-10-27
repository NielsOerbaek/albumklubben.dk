import { describe, expect, it } from 'vitest'
import { BOARD, festLines, type SignFest } from '../../web/src/klubhus/flipsign.ts'

const fest = (over: Partial<SignFest> = {}): SignFest => ({
  artist: 'Kate Bush', title: 'The Kick Inside',
  startsAt: new Date(2026, 10, 3, 11, 30).toISOString(),
  state: 'kommende', track: null, trackNumber: null, ...over,
})

const trimmed = (lines: string[]) => lines.map((l) => l.trimEnd())

describe('skærmen og lyttefesten', () => {
  it('says what is playing, and which track, while one is on', () => {
    const lines = festLines(fest({ state: 'nu', track: 'Wuthering Heights', trackNumber: 4 }), BOARD.cols, BOARD.rows)
    expect(trimmed(lines).slice(0, 3)).toEqual(['LYTTEFEST NU', 'KATE BUSH: THE KICK INSIDE', '4. WUTHERING HEIGHTS'])
  })

  it('says when the next one starts', () => {
    const lines = festLines(fest(), BOARD.cols, BOARD.rows)
    expect(trimmed(lines).slice(0, 3)).toEqual(['LYTTEFEST', '3/11 11.30', 'KATE BUSH: THE KICK INSIDE'])
  })

  it('fills the board, every line the same width', () => {
    const lines = festLines(fest(), BOARD.cols, BOARD.rows)
    expect(lines).toHaveLength(BOARD.rows)
    expect(lines.every((l) => l.length === BOARD.cols)).toBe(true)
  })
})
