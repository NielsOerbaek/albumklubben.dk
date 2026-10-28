import { describe, expect, it } from 'vitest'
import {
  catchUpText, festTracks, formatClock, formatCountdown, formatLength,
  positionAt, searchLinks, totalSeconds, trackIndexAt, trackSeconds,
} from '../../shared/lyttefest.ts'

const LIST = 'En 3:00\nTo 4:30\nTre 2:30'
const tracks = festTracks(LIST)!
const START = Date.UTC(2026, 10, 3, 11, 30) // 3. november 2026, 11.30

describe('tracklisten som et ur', () => {
  it('reads minutes, seconds and the hour-long ones', () => {
    expect(trackSeconds('3:00')).toBe(180)
    expect(trackSeconds('0:45')).toBe(45)
    expect(trackSeconds('1:02:11')).toBe(3731)
    expect(trackSeconds(' 4:30 ')).toBe(270)
  })

  it('reads nothing it cannot count on', () => {
    for (const bad of [null, '', 'ca. 4 min', '4', '4:0', '4:60', 'tre minutter']) {
      expect(trackSeconds(bad), String(bad)).toBeNull()
    }
  })

  it('numbers the tracks straight through a double album, disc after disc', () => {
    const double = festTracks('En 1:00\nTo 1:00\n\nTre 1:00')!
    expect(double.map(t => [t.number, t.disc, t.title])).toEqual([[1, 1, 'En'], [2, 1, 'To'], [3, 2, 'Tre']])
    expect(totalSeconds(double)).toBe(180)
  })

  it('refuses an album the clock cannot be run on', () => {
    expect(festTracks(null)).toBeNull()
    expect(festTracks('')).toBeNull()
    expect(festTracks('En 3:00\nTo')).toBeNull() // one track without a length is enough
    expect(festTracks('En 0:00')).toBeNull()
  })
})

describe('hvor langt lyttefesten er nået', () => {
  const at = (ms: number, cancelled = false) => positionAt(tracks, START, START + ms, cancelled)

  it('counts down before it starts', () => {
    const p = at(-90_000)
    expect(p.state).toBe('kommende')
    expect(p.seconds).toBe(90)
    expect(p.track).toBeNull()
  })

  it('is on the first track at the stroke of the hour', () => {
    const p = at(0)
    expect(p.state).toBe('nu')
    expect(p.track!.number).toBe(1)
    expect(p.into).toBe(0)
  })

  it('moves to the next track exactly when the one before ends', () => {
    expect(at(179_999).track!.number).toBe(1)
    expect(at(180_000).track!.number).toBe(2)
    expect(at(180_000).into).toBe(0)
    expect(at(185_000).into).toBe(5)
    expect(at(450_000).track!.number).toBe(3) // 3:00 + 4:30
  })

  it('is over when the last track ends, and stays over', () => {
    expect(at(599_999).state).toBe('nu')
    expect(at(600_000).state).toBe('slut')
    expect(at(600_000).track).toBeNull()
    expect(at(86_400_000).state).toBe('slut')
  })

  it('is cancelled whatever the clock says', () => {
    expect(at(-90_000, true).state).toBe('aflyst')
    expect(at(200_000, true).state).toBe('aflyst')
    expect(at(200_000, true).track).toBeNull()
  })

  it('tells someone arriving late where to skip to', () => {
    expect(catchUpText(at(185_000))).toBe('Vi er på nummer 2, 0:05 inde')
    expect(catchUpText(at(-10_000))).toBeNull()
    expect(catchUpText(at(900_000))).toBeNull()
  })

  it('puts a comment on the track it was written during', () => {
    expect(trackIndexAt(tracks, START, START + 1_000)).toBe(0)
    expect(trackIndexAt(tracks, START, START + 185_000)).toBe(1)
    // Before and after, a comment belongs to no track.
    expect(trackIndexAt(tracks, START, START - 1_000)).toBeNull()
    expect(trackIndexAt(tracks, START, START + 900_000)).toBeNull()
  })
})

describe('i ord', () => {
  it('writes a clock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(134)).toBe('2:14')
    expect(formatClock(3731)).toBe('1:02:11')
    expect(formatClock(-5)).toBe('0:00')
  })

  it('writes how long an album lasts', () => {
    expect(formatLength(600)).toBe('10 min.')
    expect(formatLength(2520)).toBe('42 min.')
    expect(formatLength(3600)).toBe('1 t.')
    expect(formatLength(4500)).toBe('1 t. 15 min.')
  })

  it('counts down in Danish', () => {
    expect(formatCountdown(20)).toBe('om 20 sekunder')
    expect(formatCountdown(60)).toBe('om 1 minut')
    expect(formatCountdown(14 * 60)).toBe('om 14 minutter')
    expect(formatCountdown(3600)).toBe('om 1 time')
    expect(formatCountdown(3 * 3600)).toBe('om 3 timer')
    expect(formatCountdown(86_400)).toBe('om 1 dag')
    expect(formatCountdown(3 * 86_400)).toBe('om 3 dage')
  })

  it('links to the album wherever people listen, without asking anyone\'s API', () => {
    const links = searchLinks('Kate Bush', 'The Kick Inside')
    // Qobuz first: it is the one the club uses. The library last: it is not a streaming service.
    expect(links.map(l => l.name)).toEqual(
      ['Qobuz', 'Spotify', 'Apple Music', 'YouTube Music', 'Tidal', 'Biblioteket'])
    expect(links[0].url).toBe('https://www.qobuz.com/dk-en/search?q=Kate%20Bush%20The%20Kick%20Inside')
    expect(links.every(l => l.url.startsWith('https://'))).toBe(true)
    expect(links.every(l => l.url.includes('Kate') && l.url.includes('Kick'))).toBe(true)
  })

  it('writes the library search the way bibliotek.dk writes it itself', () => {
    const library = searchLinks('Savage Rose', 'Black Angel').at(-1)!
    expect(library.url).toBe('https://bibliotek.dk/find/simpel?q.all=Savage+Rose+Black+Angel')
  })

  it('escapes an artist that would otherwise break the address', () => {
    const [qobuz, , , , , library] = searchLinks('AC/DC', 'Back in Black')
    expect(qobuz.url).toContain('AC%2FDC')
    expect(library.url).toContain('AC%2FDC')
    expect(() => new URL(library.url)).not.toThrow()
  })
})
