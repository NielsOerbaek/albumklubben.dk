import type { Entry } from './main.ts'

export type Filter = 'alle' | 'nostalgi' | 'dk' | 'old' | 'recent'

/** The two most recent years in the data, newest first. */
export function recentYears(entries: Entry[]): number[] {
  const years = new Set(entries.flatMap((e) => (e.album.year != null ? [e.album.year] : [])))
  return [...years].sort((a, b) => b - a).slice(0, 2)
}

export function recentLabel(years: number[]): string {
  const [hi, lo] = years
  if (lo === undefined) return String(hi)
  return hi - lo === 1 ? `${lo}-${String(hi).slice(2)}` : `${lo} og ${hi}`
}

export function matches(filter: Filter, e: Entry, recent: number[]): boolean {
  const a = e.album
  switch (filter) {
    case 'nostalgi': return !!a.pickedByName
    case 'dk': return a.country === 'Danmark'
    case 'old': return a.year != null && a.year < 2000
    case 'recent': return a.year != null && recent.includes(a.year)
    default: return true
  }
}

/** The entries a filter lets through, in archive order (oldest meeting first). */
export function filtered(entries: Entry[], filter: Filter): Entry[] {
  const recent = recentYears(entries)
  return entries.filter((e) => matches(filter, e, recent))
}
