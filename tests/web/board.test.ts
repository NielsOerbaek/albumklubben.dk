// @vitest-environment jsdom
import { render } from 'lit-html'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../web/src/board/board.ts'
import type { BoardPost } from '../../shared/board.ts'

const post = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: '1', author: { sub: 'sub-9', name: 'Medlem 1' }, title: null, body: 'Et opslag',
  createdAt: new Date().toISOString(), commentCount: 0, attachmentCount: 0, pinned: false, url: null,
  ...over,
})

/** The dialog, drawn into a div, with `fetch` answering whatever the test says. */
function mount(routes: Record<string, { status?: number; body: unknown }>) {
  const el = document.createElement('div')
  document.body.append(el)
  const asked: { url: string; method: string; body: any }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    const key = Object.keys(routes).find(k => url.startsWith(k)) ?? ''
    const route = routes[key] ?? { status: 404, body: { error: 'Ikke fundet' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  }))
  const board = createBoard({ show: (content) => render(content ?? null, el) })
  return { board, el, asked }
}

const settle = () => new Promise(r => setTimeout(r, 0))
const text = (el: HTMLElement) => el.textContent ?? ''

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('Opslagstavlen', () => {
  it('shows the group\'s posts with who wrote them and how many answers there are', async () => {
    const { board, el } = mount({
      '/api/board': { body: { items: [post({ title: 'Nyt møde', body: 'På tirsdag', commentCount: 3 })], nextCursor: null } },
    })
    board.open()
    await settle()
    expect(text(el)).toContain('Medlem 1')
    expect(text(el)).toContain('Nyt møde')
    expect(text(el)).toContain('På tirsdag')
    expect(text(el)).toContain('3')
  })

  it('puts a post on the page as text, never as HTML', async () => {
    const nasty = '<img src=x onerror="window.hacked=1">'
    const { board, el } = mount({ '/api/board': { body: { items: [post({ body: nasty })], nextCursor: null } } })
    board.open()
    await settle()
    expect(el.querySelector('img')).toBeNull()
    expect((window as any).hacked).toBeUndefined()
    expect(text(el)).toContain(nasty)
  })

  it('keeps the line breaks a member wrote', async () => {
    const { board, el } = mount({ '/api/board': { body: { items: [post({ body: 'Linje 1\nLinje 2' })], nextCursor: null } } })
    board.open()
    await settle()
    expect(el.querySelectorAll('.board-body br').length).toBe(1)
  })

  it('opens a post and fetches its comments', async () => {
    const { board, el, asked } = mount({
      '/api/board/posts/1/comments': { body: { items: [{ id: 'c1', author: { sub: 's', name: 'Medlem 2' }, body: 'Enig', createdAt: new Date().toISOString(), depth: 0 }], nextCursor: null } },
      '/api/board': { body: { items: [post()], nextCursor: null } },
    })
    board.open()
    await settle()
    el.querySelector<HTMLElement>('.board-post')!.click()
    await settle()
    expect(asked.some(a => a.url.includes('/api/board/posts/1/comments'))).toBe(true)
    expect(text(el)).toContain('Enig')
    expect(text(el)).toContain('Medlem 2')
  })

  it('writes a post as the member, with one externalId however often the button is pressed', async () => {
    const { board, el, asked } = mount({ '/api/board': { body: { items: [], nextCursor: null } } })
    board.open()
    await settle()
    el.querySelectorAll<HTMLElement>('.board-head .pill')[0].click() // Skriv et opslag
    await settle()
    const area = el.querySelector('textarea')!
    area.value = 'Hej klub'
    area.dispatchEvent(new Event('input'))
    await settle()
    const form = el.querySelector('form')!
    form.dispatchEvent(new Event('submit'))
    form.dispatchEvent(new Event('submit'))
    await settle()
    const writes = asked.filter(a => a.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0].body.body).toBe('Hej klub')
    expect(writes[0].body.externalId).toBeTruthy()
  })

  it('will not send an empty post', async () => {
    const { board, el, asked } = mount({ '/api/board': { body: { items: [], nextCursor: null } } })
    board.open()
    await settle()
    el.querySelectorAll<HTMLElement>('.board-head .pill')[0].click()
    await settle()
    expect(el.querySelector<HTMLButtonElement>('.board-write .pill')!.disabled).toBe(true)
    el.querySelector('form')!.dispatchEvent(new Event('submit'))
    await settle()
    expect(asked.filter(a => a.method === 'POST')).toHaveLength(0)
  })

  it('says what Theta said when it will not take the post', async () => {
    const { board, el } = mount({
      '/api/board/posts': { status: 403, body: { error: 'Du kan ikke skrive i gruppen lige nu' } },
      '/api/board': { body: { items: [], nextCursor: null } },
    })
    board.open()
    await settle()
    el.querySelectorAll<HTMLElement>('.board-head .pill')[0].click()
    await settle()
    const area = el.querySelector('textarea')!
    area.value = 'Hej'
    area.dispatchEvent(new Event('input'))
    await settle()
    el.querySelector('form')!.dispatchEvent(new Event('submit'))
    await settle()
    expect(text(el)).toContain('Du kan ikke skrive i gruppen lige nu')
  })

  it('offers the way back in when the session is no good any more', async () => {
    const { board, el } = mount({ '/api/board': { status: 401, body: {} } })
    board.open()
    await settle()
    expect(text(el)).toContain('Log ind igen')
    expect(el.querySelector('a.pill')?.getAttribute('href')).toBe('/auth/logout')
  })

  it('tells the room it could not be fetched, rather than throwing at it', async () => {
    const { board } = mount({ '/api/board': { status: 502, body: { error: 'Opslagstavlen kan ikke hentes lige nu' } } })
    await expect(board.peek()).resolves.toBe('error')
  })

  it('closes, and says so', async () => {
    const closed = vi.fn()
    const el = document.createElement('div')
    document.body.append(el)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: null }))))
    const board = createBoard({ show: (c) => render(c ?? null, el), onClose: closed })
    board.open()
    await settle()
    expect(board.isOpen()).toBe(true)
    el.querySelector<HTMLElement>('.board-close')!.click()
    expect(board.isOpen()).toBe(false)
    expect(closed).toHaveBeenCalled()
    expect(text(el)).toBe('')
  })
})
