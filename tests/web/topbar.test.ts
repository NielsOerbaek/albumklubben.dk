// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { html, render } from 'lit-html'
import { topBarTemplate } from '../../web/src/topbar.ts'
import { currentMe, loadMe } from '../../web/src/me.ts'

const draw = (t: unknown) => { const d = document.createElement('div'); render(t as never, d); return d }

test('renders the wordmark linking to / and the Klubhuset link', () => {
  const d = draw(topBarTemplate(null))
  const mark = d.querySelector('a.wordmark')!
  expect(mark.textContent).toBe('Albumklubben')
  expect(mark.getAttribute('href')).toBe('/')
  const links = [...d.querySelectorAll('nav a')].map((a) => [a.textContent, a.getAttribute('href')])
  expect(links).toEqual([['Klubhuset', '/klubhuset']])
  expect(d.querySelector('[aria-current]')).toBeNull()
})

test('marks the active link with aria-current', () => {
  const d = draw(topBarTemplate('klubhus'))
  const cur = d.querySelectorAll('[aria-current="page"]')
  expect(cur).toHaveLength(1)
  expect(cur[0].textContent).toBe('Klubhuset')
})

test('renders the right slot', () => {
  const d = draw(topBarTemplate(null, html`<button class="pill">Hylden</button>`))
  expect(d.querySelector('.topbar-right .pill')?.textContent).toBe('Hylden')
})

describe('hvem man er logget ind som', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /** The bar and the module that knows who you are, both fresh, so one test cannot answer another. */
  async function freshBar() {
    vi.resetModules()
    return {
      ...await import('../../web/src/me.ts'),
      topBarTemplate: (await import('../../web/src/topbar.ts')).topBarTemplate,
    }
  }
  const answer = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(body), { status })))

  test('is not in the bar before the answer has come', async () => {
    const bar = await freshBar()
    expect(draw(bar.topBarTemplate(null)).querySelector('.topbar-me')).toBeNull()
  })

  test('shows the name and the face, and draws again when the answer comes', async () => {
    answer({ sub: 'sub-1', name: 'Niels Ørbæk Chemnitz', picture: 'https://theta.test/a/1.jpg' })
    const bar = await freshBar()
    const drawn = vi.fn()
    await bar.loadMe(drawn)
    expect(drawn).toHaveBeenCalledTimes(1)
    expect(bar.currentMe()?.name).toBe('Niels Ørbæk Chemnitz')

    const d = draw(bar.topBarTemplate(null))
    expect(d.querySelector('.topbar-name')?.textContent).toBe('Niels Ørbæk Chemnitz')
    expect(d.querySelector('.topbar-me img')?.getAttribute('src')).toBe('https://theta.test/a/1.jpg')
    // The name is on the element too, for the narrow bar where only the face is shown.
    expect(d.querySelector('.topbar-me')?.getAttribute('title')).toBe('Niels Ørbæk Chemnitz')
    // And it stands beside the way out, not instead of it.
    expect(d.querySelector('.topbar-right .pill')?.getAttribute('href')).toBe('/auth/logout')
  })

  test('falls back to the initials when Theta has no picture for you', async () => {
    answer({ sub: 'sub-2', name: 'Medlem To', picture: null })
    const bar = await freshBar()
    await bar.loadMe(() => {})
    const d = draw(bar.topBarTemplate(null))
    expect(d.querySelector('.topbar-me img')).toBeNull()
    expect(d.querySelector('.topbar-me .face-initials')?.textContent).toBe('MT')
  })

  test('asks once, however many times a page asks for it', async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify({ sub: 's', name: 'Dig', picture: null })))
    vi.stubGlobal('fetch', fetched)
    const bar = await freshBar()
    await bar.loadMe(() => {})
    await bar.loadMe(() => {})
    expect(fetched).toHaveBeenCalledTimes(1)
  })

  test('leaves the bar as it was when there is no answer to be had', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const bar = await freshBar()
    const drawn = vi.fn()
    await bar.loadMe(drawn)
    expect(drawn).not.toHaveBeenCalled()
    expect(bar.currentMe()).toBeNull()

    // And the same when the session has gone: a refused ask is not a name.
    answer({ error: 'Log ind igen' }, 401)
    await bar.loadMe(drawn)
    expect(drawn).not.toHaveBeenCalled()
    expect(draw(bar.topBarTemplate(null)).querySelector('.topbar-me')).toBeNull()
  })
})
