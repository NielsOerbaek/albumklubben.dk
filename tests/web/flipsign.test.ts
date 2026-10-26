import { describe, expect, it } from 'vitest'
import { boardAt, boardLines, FLAPS, flapPath } from '../../web/src/klubhus/flipsign.ts'
import type { Album, Meeting } from '../../shared/types.ts'

const album = (artist: string, title: string, position: number) =>
  ({ artist, title, position } as Album)
const meeting = (m: Partial<Meeting>): Meeting =>
  ({ id: 1, number: 1, date: null, time: null, theme: null, albums: [], posters: [], ...m })
const pad = (s: string) => s.padEnd(26, ' ')

describe('flapPath', () => {
  it('steps forward to the target, excluding the start', () => {
    expect(flapPath('A', 'C')).toEqual(['B', 'C'])
  })

  it('wraps from the end of the alphabet back to blank', () => {
    expect(flapPath('Å', ' ')).toEqual([...'0123456789.,:-&/!?\'', ' '])
  })

  it('is empty when already there', () => {
    expect(flapPath('A', 'A')).toEqual([])
  })
})

describe('boardLines', () => {
  const m22 = meeting({
    number: 22, date: '2026-10-20',
    albums: [album('Aphex Twin', 'Drukqs', 1), album('Sigur Rós', '( )', 2)],
  })

  it('shows the meeting, then one line per album, folded and padded', () => {
    const lines = boardLines(m22, 26, 6)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe(pad('MØDE 22  20/10'))
    expect(lines[1]).toBe(pad('APHEX TWIN: DRUKQS'))
    expect(lines[2]).toBe(pad('SIGUR ROS:')) // "( )" folds to spaces
    expect(lines.slice(3)).toEqual([pad(''), pad(''), pad('')])
    for (const l of lines) expect(l).toHaveLength(26)
  })

  it('puts the theme under the meeting, and cuts long lines plainly', () => {
    const lines = boardLines(meeting({ number: 3, date: '2026-03-05', theme: 'Debutalbums',
      albums: [album('Godspeed You! Black Emperor', 'Lift Your Skinny Fists', 1)] }), 26, 6)
    expect(lines[0]).toBe(pad('MØDE 3  5/3'))
    expect(lines[1]).toBe(pad('DEBUTALBUMS'))
    expect(lines[2]).toBe('GODSPEED YOU! BLACK EMPERO')
  })

  it('keeps æøå, folds accents and blanks what the board lacks', () => {
    const [, line] = boardLines(meeting({ albums: [album('Mø', 'Æblé #1 (Ñü)', 1)] }), 26, 6)
    expect(line).toBe(pad('MØ: ÆBLE  1  NU'))
  })

  it('never shows null or undefined for a bare meeting', () => {
    const lines = boardLines(meeting({ number: 7 }), 26, 6)
    expect(lines[0]).toBe(pad('MØDE 7'))
    expect(lines.join('')).not.toMatch(/NULL|UNDEFINED/)
  })

  it('gives exactly rows lines, even with more albums than rows', () => {
    const many = meeting({ albums: Array.from({ length: 9 }, (_, i) => album(`A${i}`, `T${i}`, i + 1)) })
    const lines = boardLines(many, 26, 6)
    expect(lines).toHaveLength(6)
    expect(lines[5]).toBe(pad('A4: T4'))
  })

  it('uses only characters on the flaps', () => {
    const lines = boardLines(meeting({ number: 9, date: '2026-01-02', theme: 'Ünïcødé «quotes» – dash',
      albums: [album('Björk', 'Homogenic', 1), album('Mötley Crüe', 'Dr. Feelgood', 2), album('Ólafur', 'Ðe ß', 3)] }), 26, 6)
    for (const ch of lines.join('')) expect(FLAPS).toContain(ch)
  })
})

describe('boardAt', () => {
  const lines = ['AB', '  ']

  it('starts blank and settles on the lines', () => {
    expect(boardAt(lines, 0)).toEqual(['  ', '  '])
    expect(boardAt(lines, 10)).toEqual(lines)
  })

  it('steps through the flaps at 18 a second, each column 0.04 s after the last', () => {
    // After 1/18 s plus a little, column 0 has turned one flap: blank to A.
    expect(boardAt(lines, 1 / 18 + 0.001)[0]).toBe('A ')
    // Column 1 starts 0.04 s later, and B is two flaps from blank.
    expect(boardAt(lines, 0.04 + 1 / 18 + 0.001)[0]).toBe('AA')
    expect(boardAt(lines, 0.04 + 2 / 18 + 0.001)[0]).toBe('AB')
  })
})
