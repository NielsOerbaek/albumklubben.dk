// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { html, render } from 'lit-html'
import { topBarTemplate } from '../../web/src/topbar.ts'

const draw = (t: unknown) => { const d = document.createElement('div'); render(t as never, d); return d }

test('renders wordmark linking to / and two nav links', () => {
  const d = draw(topBarTemplate(null))
  const mark = d.querySelector('a.wordmark')!
  expect(mark.textContent).toBe('Albumklubben')
  expect(mark.getAttribute('href')).toBe('/')
  const links = [...d.querySelectorAll('nav a')].map((a) => [a.textContent, a.getAttribute('href')])
  expect(links).toEqual([['Klubhuset', '/klubhuset'], ['Arkivet', '/arkiv']])
  expect(d.querySelector('[aria-current]')).toBeNull()
})

test('marks the active link with aria-current', () => {
  const d = draw(topBarTemplate('klubhus'))
  const cur = d.querySelectorAll('[aria-current="page"]')
  expect(cur).toHaveLength(1)
  expect(cur[0].textContent).toBe('Klubhuset')
})

test('renders the right slot', () => {
  const d = draw(topBarTemplate('arkiv', html`<button class="pill">Hylden</button>`))
  expect(d.querySelector('.topbar-right .pill')?.textContent).toBe('Hylden')
})
