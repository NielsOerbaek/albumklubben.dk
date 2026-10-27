import { parseTracklist } from './tracklist.ts'

/**
 * Lyttefesten: a member picks an album and a time, and at that time everybody presses play on
 * their own speakers. Nothing is streamed; the site only keeps everyone in step by counting
 * through the tracklist from the start time. That is what this file does, and it is the same
 * sum on the server and in the page.
 */
export interface FestTrack {
  /** 1-based, counted across the whole album, discs after one another. */
  number: number
  title: string
  /** Seconds. A track with no length cannot be counted on, so a lyttefest refuses the album. */
  seconds: number
  /** Which disc it is on, 1-based. */
  disc: number
}

export type FestState = 'kommende' | 'nu' | 'slut' | 'aflyst'

export interface FestPosition {
  state: FestState
  /** Seconds until the start (`kommende`), or since it (`nu` and `slut`). */
  seconds: number
  /** The track being played, or null before and after. */
  track: FestTrack | null
  /** Seconds into that track. */
  into: number
}

const CLOCK = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/

/** "4:32" or "1:02:11" as seconds; anything else is null. */
export function trackSeconds(length: string | null): number | null {
  const m = CLOCK.exec((length ?? '').trim())
  if (!m) return null
  return m[3] === undefined
    ? Number(m[1]) * 60 + Number(m[2])
    : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * The album's tracks in playing order, with their lengths in seconds. Null when any track is
 * missing a length: a lyttefest runs on the clock, so a tracklist it cannot count is no good.
 */
export function festTracks(tracklist: string | null): FestTrack[] | null {
  const discs = parseTracklist(tracklist)
  if (discs.length === 0) return null
  const out: FestTrack[] = []
  for (const [d, disc] of discs.entries()) {
    for (const t of disc) {
      const seconds = trackSeconds(t.length)
      if (seconds === null || seconds <= 0) return null
      out.push({ number: out.length + 1, title: t.title, seconds, disc: d + 1 })
    }
  }
  return out.length > 0 ? out : null
}

export const totalSeconds = (tracks: FestTrack[]): number =>
  tracks.reduce((n, t) => n + t.seconds, 0)

/** "42 min." for the length of an album, which is how long a lyttefest lasts. */
export function formatLength(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min.`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} t.` : `${h} t. ${m} min.`
}

/** "2:14", and "1:02:14" once there is an hour in it. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h > 0 ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`
}

/** A countdown in Danish words: "om 3 dage", "om 2 timer", "om 14 minutter", "om 20 sekunder". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s >= 2 * 86400) return `om ${Math.round(s / 86400)} dage`
  if (s >= 86400) return 'om 1 dag'
  if (s >= 7200) return `om ${Math.floor(s / 3600)} timer`
  if (s >= 3600) return 'om 1 time'
  if (s >= 120) return `om ${Math.floor(s / 60)} minutter`
  if (s >= 60) return 'om 1 minut'
  return `om ${s} sekunder`
}

/**
 * Where the lyttefest is at `now`: before it, on a track, or over. `startsAt` and `now` are
 * milliseconds. A cancelled lyttefest is `aflyst` whatever the clock says.
 */
export function positionAt(
  tracks: FestTrack[],
  startsAt: number,
  now: number,
  cancelled = false,
): FestPosition {
  if (cancelled) return { state: 'aflyst', seconds: Math.round((now - startsAt) / 1000), track: null, into: 0 }
  const elapsed = (now - startsAt) / 1000
  if (elapsed < 0) return { state: 'kommende', seconds: Math.round(-elapsed), track: null, into: 0 }
  let left = elapsed
  for (const track of tracks) {
    if (left < track.seconds) return { state: 'nu', seconds: Math.round(elapsed), track, into: left }
    left -= track.seconds
  }
  return { state: 'slut', seconds: Math.round(elapsed), track: null, into: 0 }
}

/** Where someone arriving late should skip to: "Vi er på nummer 4, 1:32 inde". */
export function catchUpText(p: FestPosition): string | null {
  if (p.state !== 'nu' || !p.track) return null
  return `Vi er på nummer ${p.track.number}, ${formatClock(p.into)} inde`
}

/** Which track a comment belongs to, worked out from when it was written. */
export function trackIndexAt(tracks: FestTrack[], startsAt: number, at: number): number | null {
  const p = positionAt(tracks, startsAt, at)
  return p.track ? p.track.number - 1 : null
}

/** Plain search links, so each member can find the album wherever they listen. */
export function searchLinks(artist: string, title: string): { name: string; url: string }[] {
  const q = encodeURIComponent(`${artist} ${title}`)
  return [
    { name: 'Spotify', url: `https://open.spotify.com/search/${q}` },
    { name: 'Apple Music', url: `https://music.apple.com/dk/search?term=${q}` },
    { name: 'YouTube Music', url: `https://music.youtube.com/search?q=${q}` },
    { name: 'Tidal', url: `https://tidal.com/search?q=${q}` },
  ]
}

// ---------------------------------------------------------------------------------------------
// What the page is given.

export interface FestAlbum {
  id: number
  artist: string
  title: string
  year: number | null
  coverUrl: string | null
  cardColor: string
  meetingNumber: number
}

export interface FestComment {
  id: number
  sub: string
  name: string
  /** Which track it was written during, or null before the first and after the last. */
  trackIndex: number | null
  text: string
  createdAt: string
}

export interface FestPerson { sub: string; name: string }

export interface FestView {
  id: number
  album: FestAlbum
  host: FestPerson
  /** UTC ISO. */
  startsAt: string
  note: string | null
  tracks: FestTrack[]
  cancelled: boolean
  /** The announcement in the club's group, to read it there. */
  thetaUrl: string | null
  coming: FestPerson[]
  comments: FestComment[]
  /** About the member reading the page. */
  you: { coming: boolean; host: boolean }
  /** The server's clock when it answered, so the page can measure its own offset to it. */
  now: string
}

/** A lyttefest as it is listed beside its album. */
export interface FestSummary {
  id: number
  startsAt: string
  cancelled: boolean
  host: FestPerson
  coming: number
}
