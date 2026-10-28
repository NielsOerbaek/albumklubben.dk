// @vitest-environment jsdom
import { render } from 'lit-html'
import { afterEach, describe, expect, it } from 'vitest'
import { ribbonView } from '../../web/src/arkiv/ribbon.ts'
import type { FestBrief } from '../../shared/lyttefest.ts'

const NOW = Date.UTC(2026, 10, 3, 10, 30)

const fest = (over: Partial<FestBrief> = {}): FestBrief => ({
  id: 1, artist: 'Kate Bush', title: 'The Kick Inside', coverUrl: '/uploads/covers/1.jpg',
  startsAt: new Date(NOW + 60 * 60_000).toISOString(), state: 'kommende',
  track: null, trackNumber: null, coming: 0, ...over,
})

function draw(fests: FestBrief[]) {
  const d = document.createElement('div')
  document.body.append(d)
  render(ribbonView(fests, NOW) as never, d)
  return d
}

const text = (d: HTMLElement) => (d.textContent ?? '').replace(/\s+/g, ' ').trim()

afterEach(() => { document.body.innerHTML = '' })

describe('lyttefest-båndet', () => {
  it('is not there at all when no lyttefest is coming', () => {
    expect(draw([]).querySelectorAll('.ribbon')).toHaveLength(0)
  })

  it('says what is playing, and which track, while one plays', () => {
    const d = draw([fest({ state: 'nu', track: 'Wuthering Heights', trackNumber: 4, coming: 5 })])
    expect(d.querySelector('.ribbon-kicker')?.textContent).toBe('Lyttefest nu')
    expect(d.querySelector('.ribbon-album')?.textContent).toBe('Kate Bush – The Kick Inside')
    expect(text(d)).toContain('Spiller nu · 4. Wuthering Heights')
    expect(text(d)).toContain('5 kommer')
    expect(d.querySelector('.ribbon')?.classList.contains('is-now')).toBe(true)
  })

  it('counts down to one that has not started, and gives the time in words', () => {
    const d = draw([fest({ startsAt: new Date(NOW + 95 * 60_000).toISOString() })])
    expect(text(d)).toContain('Starter om 1 time')
    expect(text(d)).toContain('kl. 13.05') // Copenhagen, which is the time the club lives in
    expect(d.querySelector('.ribbon')?.classList.contains('is-now')).toBe(false)
  })

  it('says plainly when nobody has said yes yet', () => {
    expect(text(draw([fest()]))).toContain('Ingen har sagt ja endnu')
  })

  it('is the way in to the lyttefest, cover and all', () => {
    const d = draw([fest({ id: 7 })])
    expect(d.querySelector('a.ribbon')?.getAttribute('href')).toBe('/lyttefest/7')
    // The cover is decorative: the album is named in the text beside it.
    const img = d.querySelector('.ribbon-cover')!
    expect(img.getAttribute('src')).toBe('/thumb/256/covers/1.jpg')
    expect(img.getAttribute('alt')).toBe('')
  })

  it('manages without a cover', () => {
    const d = draw([fest({ coverUrl: null })])
    expect(d.querySelectorAll('.ribbon-cover')).toHaveLength(0)
    expect(text(d)).toContain('Kate Bush – The Kick Inside')
  })

  it('shows the one playing and the next ones, but does not become a list', () => {
    const many = Array.from({ length: 6 }, (_, i) => fest({ id: i + 1 }))
    expect(draw(many).querySelectorAll('.ribbon')).toHaveLength(3)
  })

  it('leaves out one that is over or called off, whatever it was sent', () => {
    expect(draw([fest({ state: 'slut' }), fest({ state: 'aflyst' })]).querySelectorAll('.ribbon'))
      .toHaveLength(0)
  })
})
