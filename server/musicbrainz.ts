export const USER_AGENT = 'Albumklubben/1.0 ( https://albumklubben.dk )'
const BASE = 'https://musicbrainz.org/ws/2/'
const GAP_MS = 1000

export interface LookupOptions { fetch?: typeof fetch; wait?: (ms: number) => Promise<void> }

// One queue per process (the CLI and the CMS are separate processes, so each keeps its own 1 request/second pace).
let queue: Promise<unknown> = Promise.resolve()
let lastAt = 0

function get<T>(path: string, params: Record<string, string>, opts: LookupOptions): Promise<T> {
  const doFetch = opts.fetch ?? fetch
  const wait = opts.wait ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const run = async (): Promise<T> => {
    const delay = lastAt + GAP_MS - Date.now()
    if (delay > 0) await wait(delay)
    lastAt = Date.now()
    const url = `${BASE}${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`
    const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`MusicBrainz svarede ${res.status}`)
    return (await res.json()) as T
  }
  const result = queue.then(run, run)
  queue = result.catch(() => {})
  return result
}

const lucene = (s: string) => s.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&')

interface Group { id: string; score?: number; 'primary-type'?: string; 'secondary-types'?: string[] }
interface Release { id: string; title: string; status?: string; date?: string; country?: string; media?: unknown[] }
interface Medium { tracks?: { title: string; length: number | null }[] }

function duration(ms: number | null | undefined): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  const sec = String(s % 60).padStart(2, '0')
  return s >= 3600 ? ` ${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${sec}` : ` ${Math.floor(s / 60)}:${sec}`
}

const rank = (r: Release): [number, string, number] =>
  [r.status === 'Official' ? 0 : 1, r.date || '9999', r.media?.length ?? 99]

function compare(a: Release, b: Release): number {
  const [x, y] = [rank(a), rank(b)]
  return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || x[2] - y[2]
}

export async function findTracklist(
  artist: string, title: string, opts: LookupOptions = {},
): Promise<{ tracklist: string; release: string } | null> {
  const query = `artist:"${lucene(artist)}" AND releasegroup:"${lucene(title)}"`
  const found = await get<{ 'release-groups'?: Group[] }>('release-group', { query, limit: '10' }, opts)
  const group = (found['release-groups'] ?? [])
    .filter(g => g['primary-type'] === 'Album')
    // Equal scores: a plain studio album before a compilation or live album.
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a['secondary-types']?.length ?? 0) - (b['secondary-types']?.length ?? 0))[0]
  if (!group) return null

  const list = await get<{ releases?: Release[] }>('release', { 'release-group': group.id, inc: 'media', limit: '100' }, opts)
  const release = [...(list.releases ?? [])].sort(compare)[0]
  if (!release) return null

  const full = await get<{ media?: Medium[] }>(`release/${release.id}`, { inc: 'recordings' }, opts)
  const discs = (full.media ?? []).map(m => (m.tracks ?? []).map(t => `${t.title}${duration(t.length)}`))
    .filter(d => d.length)
  if (!discs.length) return null
  const count = discs.reduce((n, d) => n + d.length, 0)
  const when = [release.date, release.country].filter(Boolean).join(', ')
  return {
    tracklist: discs.map(d => d.join('\n')).join('\n\n'),
    release: `${release.title}${when ? ` (${when})` : ''}, ${count} spor`,
  }
}
