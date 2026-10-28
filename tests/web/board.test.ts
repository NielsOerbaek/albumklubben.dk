import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoardError, createBoard } from '../../web/src/board/board.ts'
import type { BoardPost } from '../../shared/board.ts'

const post = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: '1', author: { sub: 'sub-9', name: 'Medlem 1' }, title: null, body: 'Et opslag',
  createdAt: new Date().toISOString(), commentCount: 0, attachmentCount: 0,
  url: 'https://theta.test/grupper/1/opslag/1',
  lyttefest: null,
  ...over,
})

/** `fetch` answering whatever the test says, one answer per call, and keeping what was asked. */
function serve(...answers: ({ status?: number; body: unknown })[]) {
  const asked: string[] = []
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(url)
    const a = answers[Math.min(i++, answers.length - 1)]
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 })
  }))
  return asked
}

const page = (items: BoardPost[], nextCursor: string | null = null) =>
  ({ body: { items, nextCursor, groupUrl: 'https://theta.test/grupper/1' } })

afterEach(() => { vi.unstubAllGlobals() })

describe('at læse opslagstavlen', () => {
  it('reads the group and keeps what came back', async () => {
    serve(page([post({ title: 'Nyt møde', commentCount: 3 })]))
    const board = createBoard()
    await board.load()
    const state = board.state()
    expect(state.posts.map(p => p.title)).toEqual(['Nyt møde'])
    expect(state.groupUrl).toBe('https://theta.test/grupper/1')
    expect(state.busy).toBe(false)
    expect(state.error).toBeNull()
  })

  it('says when it is busy, before and after', async () => {
    serve(page([post()]))
    const seen: boolean[] = []
    const board = createBoard(() => seen.push(board.state().busy))
    await board.load()
    expect(seen).toEqual([true, false])
  })

  it('adds the next page to the one in hand, and reads the newest from the top again', async () => {
    const asked = serve(page([post({ id: '1' })], 'c2'), page([post({ id: '2' })]), page([post({ id: '3' })]))
    const board = createBoard()
    await board.load()
    await board.more()
    expect(board.state().posts.map(p => p.id)).toEqual(['1', '2'])
    expect(asked[1]).toBe('/api/board?cursor=c2')

    await board.load()
    expect(board.state().posts.map(p => p.id)).toEqual(['3'])
    expect(asked[2]).toBe('/api/board')
  })

  it('does not ask for more when there is no more to be had', async () => {
    const asked = serve(page([post()]))
    const board = createBoard()
    await board.load()
    await board.more()
    expect(asked).toHaveLength(1)
  })

  it('escapes a cursor on its way into the address', async () => {
    const asked = serve(page([post()], 'a b&c'), page([]))
    const board = createBoard()
    await board.load()
    await board.more()
    expect(asked[1]).toBe('/api/board?cursor=a%20b%26c')
  })

  it('says in Danish when Theta will not answer, and keeps what it had', async () => {
    serve(page([post({ title: 'Nyt møde' })], 'c2'), { status: 502, body: { error: 'Opslagstavlen kan ikke hentes lige nu' } })
    const board = createBoard()
    await board.load()
    await board.more()
    expect(board.state().error?.message).toBe('Opslagstavlen kan ikke hentes lige nu')
    expect(board.state().posts.map(p => p.title)).toEqual(['Nyt møde'])
  })

  it('asks for a new login when the session has gone', async () => {
    serve({ status: 401, body: { error: 'Log ind igen' } })
    const board = createBoard()
    await board.load()
    expect(board.state().error).toBeInstanceOf(BoardError)
    expect(board.state().error?.needsLogin).toBe(true)
  })

  it('does not throw when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const board = createBoard()
    await board.load()
    expect(board.state().error?.message).toBe('Opslagstavlen kan ikke hentes lige nu')
    expect(board.state().error?.needsLogin).toBe(false)
  })
})

describe('det kig tavlen på væggen tager', () => {
  it('gives the posts back for the board in the room', async () => {
    serve(page([post({ id: '7' })]))
    const board = createBoard()
    expect(await board.peek()).toEqual([expect.objectContaining({ id: '7' })])
    expect(board.state().posts).toHaveLength(1)
  })

  it('says "error" rather than throwing, so a dead Theta never holds the room back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await createBoard().peek()).toBe('error')
  })
})
