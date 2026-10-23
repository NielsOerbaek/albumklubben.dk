// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from 'lit-html'
import { cardTemplate, inkFor, storyTemplate } from '../../web/src/card.ts'
import type { Album } from '../../shared/types.ts'

const jeff: Album = { id: 1, meetingId: 1, position: 0, artist: 'Jeff Buckley', title: 'Grace', year: 1994,
  origin: 'Anaheim', country: 'USA, Californien', lat: null, lng: null, genre: 'Alternativ Rock',
  gender: 'Mand', status: 'Døde d. 29.maj 1997 (30år)', pickedByName: 'Medlem 9',
  pickedByWorkplace: 'Arbejdsplads B', story: 'En stemme.', cardColor: '#262d66', coverUrl: null }

const draw = (t: unknown) => { const d = document.createElement('div'); render(t as never, d); return d }

test('inkFor picks readable text', () => {
  expect(inkFor('#262d66')).toBe('#ffffff')
  expect(inkFor('#ccc1b4')).toBe('#121316')
})

test('full card', () => {
  const text = draw(cardTemplate(jeff, 21)).textContent!.replace(/\s+/g, ' ')
  for (const s of ['MØDE 21', 'Jeff Buckley, Grace (1994)', 'Kunstners oprindelsesland:',
    'Nostalgialbum: Valgt af Medlem 9, Arbejdsplads B']) expect(text).toContain(s)
})

test('missing optional fields', () => {
  const a = { ...jeff, status: 'Aktiv', pickedByName: null, year: null, story: null }
  const text = draw(cardTemplate(a, 3)).textContent!
  expect(text).not.toContain('Nostalgialbum')
  expect(text).toContain('Jeff Buckley, Grace')
  expect(text).not.toContain('(')
  expect(text).not.toMatch(/null|undefined/)
  expect(draw(storyTemplate(a)).textContent).toBe('')
})

test('story renders as a quote; hostile title stays text', () => {
  expect(draw(storyTemplate(jeff)).querySelector('blockquote')?.textContent).toBe('En stemme.')
  const d = draw(cardTemplate({ ...jeff, title: '<b>x</b>' }, 1))
  expect(d.querySelector('b')).toBeNull()
  expect(d.textContent).toContain('<b>x</b>')
})
