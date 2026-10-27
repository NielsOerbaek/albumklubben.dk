// @vitest-environment jsdom
import { render } from 'lit-html'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../web/src/board/board.ts'
import type { BoardPost } from '../../shared/board.ts'

const post = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: '1', author: { sub: 'sub-9', name: 'Medlem 1' }, title: null, body: 'Et opslag',
  createdAt: new Date().toISOString(), commentCount: 0, attachmentCount: 0,
  url: 'https://theta.test/grupper/1/opslag/1',
  lyttefest: null,
  ...over,
})

/** The dialog, drawn into a div, with `fetch` answering whatever the test says. */
function mount(route: { status?: number; body: unknown }) {
  const el = document.createElement('div')
  document.body.append(el)
  const asked: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url, method: init?.method ?? 'GET' })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  }))
  const board = createBoard({ show: (content) => render(content ?? null, el) })
  return { board, el, asked }
}

const page = (items: BoardPost[], groupUrl: string | null = 'https://theta.test/grupper/1') =>
  ({ body: { items, nextCursor: null, groupUrl } })

const settle = () => new Promise(r => setTimeout(r, 0))
const text = (el: HTMLElement) => el.textContent ?? ''

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('Opslagstavlen', () => {
  it('shows the group\'s posts with who wrote them and how many answers there are', async () => {
    const { board, el } = mount(page([post({ title: 'Nyt møde', body: 'På tirsdag', commentCount: 3 })]))
    board.open()
    await settle()
    expect(text(el)).toContain('Medlem 1')
    expect(text(el)).toContain('Nyt møde')
    expect(text(el)).toContain('På tirsdag')
    expect(text(el)).toContain('3 kommentarer')
  })

  it('opens a post on Theta, and renders no thread of its own', async () => {
    const { board, el, asked } = mount(page([post({ commentCount: 3 })]))
    board.open()
    await settle()
    const link = el.querySelector<HTMLAnchorElement>('a.board-post')!
    expect(link.getAttribute('href')).toBe('https://theta.test/grupper/1/opslag/1')
    expect(link.getAttribute('target')).toBe('_blank')
    link.click()
    await settle()
    // Clicking a post fetches nothing: there is no thread to fetch, and no form to fill in.
    expect(asked.filter(a => a.url.includes('/comments'))).toHaveLength(0)
    expect(el.querySelector('textarea')).toBeNull()
    expect(el.querySelector('form')).toBeNull()
  })

  it('points at the group, for writing something', async () => {
    const { board, el } = mount(page([post()]))
    board.open()
    await settle()
    const write = [...el.querySelectorAll('a.pill')].find(a => a.textContent?.includes('Skriv på Theta'))
    expect(write?.getAttribute('href')).toBe('https://theta.test/grupper/1')
    expect(text(el)).toContain('Opslag skrives, besvares og læses på Theta')
  })

  it('marks a lyttefest as one', async () => {
    const { board, el } = mount(page([post({
      lyttefest: { id: 2, artist: 'Kate Bush', title: 'The Kick Inside', coverUrl: null },
    })]))
    board.open()
    await settle()
    expect(el.querySelector('.board-tag')?.textContent).toBe('Lyttefest')
  })

  it('puts a post on the page as text, never as HTML', async () => {
    const nasty = '<img src=x onerror="window.hacked=1">'
    const { board, el } = mount(page([post({ body: nasty })]))
    board.open()
    await settle()
    expect(el.querySelector('img')).toBeNull()
    expect((window as any).hacked).toBeUndefined()
    expect(text(el)).toContain(nasty)
  })

  it('keeps the line breaks a member wrote', async () => {
    const { board, el } = mount(page([post({ body: 'Linje 1\nLinje 2' })]))
    board.open()
    await settle()
    expect(el.querySelectorAll('.board-body br').length).toBe(1)
  })

  it('offers the way back in when the session is no good any more', async () => {
    const { board, el } = mount({ status: 401, body: {} })
    board.open()
    await settle()
    expect(text(el)).toContain('Log ind igen')
    expect(el.querySelector('.board-note a.pill')?.getAttribute('href')).toBe('/auth/logout')
  })

  it('tells the room it could not be fetched, rather than throwing at it', async () => {
    const { board } = mount({ status: 502, body: { error: 'Opslagstavlen kan ikke hentes lige nu' } })
    await expect(board.peek()).resolves.toBe('error')
  })

  it('closes, and says so', async () => {
    const closed = vi.fn()
    const el = document.createElement('div')
    document.body.append(el)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: null, groupUrl: null }))))
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
