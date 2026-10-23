import { expect, test } from 'vitest'
import { genreFamily } from '../../shared/genre.ts'

test.each([
  ['Pop-punk og Skatepunk', 'Punk'],
  ['Hip Hop & Rap', 'Hip hop'],
  ['Folk, Indie og Indie rock', 'Folk & country'],
  ['Americana og Roots Rock', 'Folk & country'],
  ['Bollywood og EDM', 'Elektronisk'],
  ['Art pop og Electronica', 'Elektronisk'],
  ['Rock, Soul og Blues', 'Soul & R&B'],
  ['Indierock', 'Rock'],
  ['MPB (Música popular brasileira) og Jazz', 'Andet'],
])('%s -> %s', (genre, family) => expect(genreFamily(genre)).toBe(family))
