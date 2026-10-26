export type Track = { title: string; length: string | null }
export type Disc = Track[]

const DURATION = /^(.*\S)\s+(\d+(?::\d{2}){1,2})$/

export function parseTracklist(text: string | null): Disc[] {
  const discs: Disc[] = []
  let disc: Disc = []
  for (const raw of (text ?? '').split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) {
      if (disc.length) discs.push(disc)
      disc = []
      continue
    }
    const m = DURATION.exec(line)
    disc.push(m ? { title: m[1], length: m[2] } : { title: line, length: null })
  }
  if (disc.length) discs.push(disc)
  return discs
}

export const formatTracklist = (discs: Disc[]): string =>
  discs.map(d => d.map(t => (t.length ? `${t.title} ${t.length}` : t.title)).join('\n')).join('\n\n')
