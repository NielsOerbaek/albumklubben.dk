export type GenreFamily = 'Pop' | 'Rock' | 'Elektronisk' | 'Soul & R&B' | 'Hip hop' | 'Punk'
  | 'Metal' | 'Folk & country' | 'Andet'

export const GENRE_ORDER: GenreFamily[] = ['Pop', 'Rock', 'Elektronisk', 'Soul & R&B', 'Hip hop',
  'Punk', 'Metal', 'Folk & country', 'Andet']

const RULES: [RegExp, GenreFamily][] = [
  [/hip hop|rap/, 'Hip hop'],
  [/metal/, 'Metal'],
  [/punk/, 'Punk'],
  [/country|folk|americana/, 'Folk & country'],
  [/soul|r&b/, 'Soul & R&B'],
  [/techno|elektron|electronica|idm|edm|house|drill/, 'Elektronisk'],
  [/rock/, 'Rock'],
  [/pop(?!ular)/, 'Pop'],
]

export function genreFamily(genre: string): GenreFamily {
  const g = genre.toLowerCase()
  return RULES.find(([re]) => re.test(g))?.[1] ?? 'Andet'
}
