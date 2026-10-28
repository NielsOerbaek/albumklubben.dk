/**
 * Who is in the band, counted.
 *
 * This used to be one free-text line per album — "Mand", "Tre kvinder", "5 mænd og 1 kvinde" —
 * which read well on a card and made a useless chart: sixteen columns, most of them one album
 * high. It is four numbers now, written down when the album is, so the chart adds rather than
 * guesses. `tools/gender-to-lineup.ts` is what turned the old lines into these, once.
 *
 * An album stands in a bar for every gender it has anyone of, so a band of five men and one
 * woman is in both.
 */
export interface Lineup {
  men: number
  women: number
  nonbinary: number
  /** Anyone the three above do not name, and the count for an album nobody filled in. */
  other: number
}

export type LineupKey = keyof Lineup

/** The order the bars stand in, which does not change with the data. */
export const LINEUP_KEYS: LineupKey[] = ['men', 'women', 'nonbinary', 'other']

export const LINEUP_LABEL: Record<LineupKey, string> = {
  men: 'Mænd',
  women: 'Kvinder',
  nonbinary: 'Nonbinære',
  other: 'Andet',
}

/** Singular and plural, for writing a lineup out in words. */
const COUNTED: Record<LineupKey, [string, string]> = {
  men: ['mand', 'mænd'],
  women: ['kvinde', 'kvinder'],
  nonbinary: ['nonbinær', 'nonbinære'],
  other: ['anden', 'andre'],
}

export const EMPTY_LINEUP: Lineup = { men: 0, women: 0, nonbinary: 0, other: 0 }

/** A lineup from anything shaped like one, with what is missing or nonsense read as none. */
export function toLineup(raw: unknown): Lineup {
  const r = (raw ?? {}) as Partial<Record<LineupKey, unknown>>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
  return { men: n(r.men), women: n(r.women), nonbinary: n(r.nonbinary), other: n(r.other) }
}

export const lineupTotal = (l: Lineup): number => LINEUP_KEYS.reduce((n, k) => n + l[k], 0)

/** "5 mænd, 1 kvinde" for the album's card. Empty when nobody was counted. */
export function describeLineup(l: Lineup): string {
  return LINEUP_KEYS
    .filter(k => l[k] > 0)
    .map(k => `${l[k]} ${COUNTED[k][l[k] === 1 ? 0 : 1]}`)
    .join(', ')
}
