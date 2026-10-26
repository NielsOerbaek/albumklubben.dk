import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findTracklist, USER_AGENT } from '../../server/musicbrainz.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function fakeFetch(opts: { groups?: unknown[]; releases?: unknown[]; tracks?: Record<string, unknown>; status?: number } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    if (opts.status) return json({}, opts.status)
    if (url.includes('/release-group?')) return json({ 'release-groups': opts.groups ?? [] })
    if (url.includes('/release?')) return json({ releases: opts.releases ?? [] })
    const id = /\/release\/([^?]+)\?/.exec(url)![1]
    return json(opts.tracks![id])
  }) as typeof fetch
  return { fn, calls }
}

const query = (url: string) => new URL(url).searchParams.get('query')!
const media = (...counts: number[]) => counts.map(n => ({ 'track-count': n }))
const rel = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: 'Album', status: 'Official', date: '2000-01-01', country: 'GB', media: media(10), ...extra })
const disc = (...tracks: [string, number | null][]) => ({ tracks: tracks.map(([title, length]) => ({ title, length })) })

// The pacing queue is module state: every test starts a minute later than the last one.
let clock = Date.parse('2030-01-01T00:00:00Z')
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime((clock += 60_000)) })
afterEach(() => vi.useRealTimers())

const noWait = async () => {}

describe('findTracklist', () => {
  it('picks the highest-scored Album release group', async () => {
    const f = fakeFetch({
      groups: [
        { id: 'single', score: 100, 'primary-type': 'Single' },
        { id: 'low', score: 70, 'primary-type': 'Album' },
        { id: 'best', score: 90, 'primary-type': 'Album' },
        { id: 'compilation', score: 90, 'primary-type': 'Album', 'secondary-types': ['Compilation'] },
      ],
      releases: [rel('r1')],
      tracks: { r1: { media: [disc(['A', 1000])] } },
    })
    await findTracklist('Aphex Twin', 'Windowlicker', { fetch: f.fn, wait: noWait })
    expect(f.calls[1].url).toContain('release-group=best')
    expect(query(f.calls[0].url)).toContain('artist:"Aphex Twin" AND releasegroup:"Windowlicker"')
  })

  it('escapes Lucene special characters', async () => {
    const f = fakeFetch()
    await findTracklist('AC/DC', 'Back "in" Black (1)', { fetch: f.fn, wait: noWait })
    const q = query(f.calls[0].url)
    expect(q).toContain('artist:"AC\\/DC"')
    expect(q).toContain('releasegroup:"Back \\"in\\" Black \\(1\\)"')
  })

  it('prefers Official, then earliest date, then fewest media', async () => {
    const pick = async (releases: unknown[]) => {
      const f = fakeFetch({
        groups: [{ id: 'g', score: 100, 'primary-type': 'Album' }], releases,
        tracks: Object.fromEntries((releases as { id: string }[]).map(r => [r.id, { media: [disc(['A', null])] }])),
      })
      await findTracklist('a', 'b', { fetch: f.fn, wait: noWait })
      return /\/release\/([^?]+)\?/.exec(f.calls[2].url)![1]
    }
    expect(await pick([rel('bootleg', { status: 'Bootleg', date: '1990' }), rel('official', { date: '2005' })])).toBe('official')
    expect(await pick([rel('late', { date: '2010-05-01' }), rel('early', { date: '2001-03-02' })])).toBe('early')
    expect(await pick([rel('two', { media: media(8, 8) }), rel('one', { media: media(16) })])).toBe('one')
    expect(await pick([rel('undated', { date: undefined }), rel('dated', { date: '2020' })])).toBe('dated')
  })

  it('formats lengths as m:ss and keeps discs apart', async () => {
    const f = fakeFetch({
      groups: [{ id: 'g', score: 100, 'primary-type': 'Album' }],
      releases: [rel('r', { title: 'Double', date: '1999-09-09', country: 'DK', media: media(2, 1) })],
      tracks: { r: { media: [disc(['Ét', 225000], ['To', null]), disc(['Tre', 3_725_000])] } },
    })
    const r = await findTracklist('a', 'b', { fetch: f.fn, wait: noWait })
    expect(r).toEqual({ tracklist: 'Ét 3:45\nTo\n\nTre 1:02:05', release: 'Double (1999-09-09, DK), 3 spor' })
  })

  it('spaces requests at least 1000 ms apart and sends the User-Agent', async () => {
    const f = fakeFetch({
      groups: [{ id: 'g', score: 100, 'primary-type': 'Album' }], releases: [rel('r')],
      tracks: { r: { media: [disc(['A', 1000])] } },
    })
    const waits: number[] = []
    await findTracklist('a', 'b', { fetch: f.fn, wait: async ms => { waits.push(ms) } })
    expect(waits).toEqual([1000, 1000])  // three requests: none before the first
    expect(f.calls.every(c => c.headers['User-Agent'] === USER_AGENT)).toBe(true)
    expect(USER_AGENT).toBe('Albumklubben/1.0 ( https://albumklubben.dn.osogdata.dk )')
    expect(f.calls.every(c => c.url.startsWith('https://musicbrainz.org/ws/2/') && c.url.includes('fmt=json'))).toBe(true)
  })

  it('returns null when nothing matches', async () => {
    expect(await findTracklist('a', 'b', { fetch: fakeFetch().fn, wait: noWait })).toBeNull()
    const onlySingle = fakeFetch({ groups: [{ id: 's', score: 100, 'primary-type': 'Single' }] })
    expect(await findTracklist('a', 'b', { fetch: onlySingle.fn, wait: noWait })).toBeNull()
  })

  it('throws on an HTTP error', async () => {
    await expect(findTracklist('a', 'b', { fetch: fakeFetch({ status: 503 }).fn, wait: noWait })).rejects.toThrow('503')
  })
})
