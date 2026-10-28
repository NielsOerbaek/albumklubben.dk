import type { AlbumInput, MeetingInput, PosterInput } from '../../shared/types.ts'
import type { Lineup, LineupKey } from '../../shared/gender.ts'

type Fields = Record<string, string>
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> }

const text = (f: Fields, k: string): string => (f[k] ?? '').trim()
const optional = (f: Fields, k: string): string | null => text(f, k) || null

function done<T>(errors: Record<string, string>, value: T): Parsed<T> {
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value }
}

export function parseMeetingForm(f: Fields): Parsed<MeetingInput> {
  const errors: Record<string, string> = {}
  const number = Number(text(f, 'number'))
  if (!/^\d+$/.test(text(f, 'number')) || number < 1) errors.number = 'Møde skal have et nummer (helt tal)'
  return done(errors, {
    number, date: optional(f, 'date'), time: optional(f, 'time'), theme: optional(f, 'theme'),
  })
}

export function parseAlbumForm(f: Fields): Parsed<Omit<AlbumInput, 'coverPath'>> {
  const errors: Record<string, string> = {}
  if (!text(f, 'artist')) errors.artist = 'Kunstner mangler'
  if (!text(f, 'title')) errors.title = 'Titel mangler'
  if (!/^#[0-9a-fA-F]{6}$/.test(text(f, 'card_color'))) errors.card_color = 'Kortfarven skal være på formen #rrggbb'

  let year: number | null = null
  if (text(f, 'year')) {
    if (/^\d{4}$/.test(text(f, 'year'))) year = Number(text(f, 'year'))
    else errors.year = 'År skal være fire cifre'
  }

  let lat: number | null = null
  let lng: number | null = null
  if (text(f, 'lat') || text(f, 'lng')) {
    lat = text(f, 'lat') ? Number(text(f, 'lat').replace(',', '.')) : NaN
    lng = text(f, 'lng') ? Number(text(f, 'lng').replace(',', '.')) : NaN
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) {
      errors.lat = 'Breddegrad (-90 til 90) og længdegrad (-180 til 180) skal begge være tal'
      lat = lng = null
    }
  }

  return done(errors, {
    artist: text(f, 'artist'), title: text(f, 'title'), year,
    origin: text(f, 'origin'), country: text(f, 'country'), lat, lng,
    genre: text(f, 'genre'), lineup: lineupFrom(f), status: text(f, 'status'),
    pickedByName: optional(f, 'picked_by_name'), pickedByWorkplace: optional(f, 'picked_by_workplace'),
    story: optional(f, 'story'), cardColor: text(f, 'card_color').toLowerCase(),
    tracklist: optional({ tracklist: (f.tracklist ?? '').replace(/\r\n?/g, '\n') }, 'tracklist'),
  })
}

/** Who is in the band: four counts, where anything blank or not a number is nobody. */
function lineupFrom(f: Fields): Lineup {
  const one = (name: LineupKey) => {
    const n = Number((f[`lineup_${name}`] ?? '').trim())
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  return { men: one('men'), women: one('women'), nonbinary: one('nonbinary'), other: one('other') }
}

/** Caption and about are the text fields; image and video come from the upload. */
export function parsePosterForm(f: Fields): { ok: true; value: Pick<PosterInput, 'caption' | 'about'> } {
  return { ok: true, value: { caption: optional(f, 'caption'), about: optional(f, 'about') } }
}
