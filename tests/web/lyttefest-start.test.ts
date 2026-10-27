// @vitest-environment jsdom
import { render } from 'lit-html'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLyttefestPanel } from '../../web/src/lyttefest/start.ts'
import type { Album } from '../../shared/types.ts'

const album = (tracklist: string | null): Album => ({
  id: 7, meetingId: 1, position: 1, artist: 'Kate Bush', title: 'The Kick Inside', year: 1978,
  origin: '', country: '', lat: null, lng: null, genre: '', gender: '', status: '',
  pickedByName: null, pickedByWorkplace: null, story: null, cardColor: '#fe3ebe',
  coverUrl: null, tracklist,
})

function mount(list: unknown[] = []) {
  const el = document.createElement('div')
  document.body.append(el)
  const asked: { url: string; body: any }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify(url.includes('/lyttefester') ? list : { id: 3 }), { status: 200 })
  }))
  const panel = createLyttefestPanel(() => draw())
  let current = album('En 3:00')
  const draw = () => render(panel.template(current), el)
  return { panel, el, asked, show: (a: Album) => { current = a; draw() } }
}

const settle = () => new Promise(r => setTimeout(r, 0))
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('at starte en lyttefest fra et album', () => {
  it('offers it when the tracklist has times', async () => {
    const { el, panel, show } = mount()
    panel.open(7)
    show(album('En 3:00\nTo 4:30'))
    await settle()
    const button = el.querySelector<HTMLButtonElement>('.fest-start .pill')!
    expect(button.textContent?.trim()).toBe('Start en lyttefest')
    expect(button.disabled).toBe(false)
  })

  it('says why it cannot, when a track has no time', async () => {
    const { el, panel, show } = mount()
    panel.open(7)
    show(album('En\nTo'))
    await settle()
    expect(el.querySelector<HTMLButtonElement>('.fest-start .pill')!.disabled).toBe(true)
    expect(el.textContent).toContain('Kræver en tracklist med spilletider')
  })

  it('lists the ones that album has had', async () => {
    const { el, panel, show } = mount([
      { id: 2, startsAt: '2026-11-03T10:30:00.000Z', cancelled: false, host: { sub: 's1', name: 'Medlem 1' }, coming: 4 },
      { id: 1, startsAt: '2026-10-01T10:30:00.000Z', cancelled: true, host: { sub: 's2', name: 'Medlem 2' }, coming: 0 },
    ])
    panel.open(7)
    show(album('En 3:00'))
    await settle()
    const links = [...el.querySelectorAll('.fest-start-list a')].map(a => a.getAttribute('href'))
    expect(links).toEqual(['/lyttefest/2', '/lyttefest/1'])
    expect(el.textContent).toContain('Medlem 1, 4 kommer')
    expect(el.textContent).toContain('aflyst')
  })

  it('sends the album, the time and the note, and will not send without a time', async () => {
    const { el, panel, asked, show } = mount()
    panel.open(7)
    show(album('En 3:00'))
    await settle()
    el.querySelector<HTMLButtonElement>('.fest-start .pill')!.click()
    await settle()
    // The form opens with a time already in it, half an hour out.
    const when = el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    expect(when.value).toBeTruthy()
    const note = el.querySelector<HTMLInputElement>('input[type="text"]')!
    note.value = 'Tag kaffe med'
    note.dispatchEvent(new Event('input'))
    el.querySelector('form')!.dispatchEvent(new Event('submit'))
    await settle()
    const write = asked.find(a => a.url === '/api/lyttefest')!
    expect(write.body.albumId).toBe(7)
    expect(write.body.note).toBe('Tag kaffe med')
    expect(Date.parse(write.body.startsAt)).toBeGreaterThan(Date.now())
  })
})
