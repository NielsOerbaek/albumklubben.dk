import { describe, expect, it } from 'vitest'
import { fitLine, menuItems, nextRow, windowStart } from '../../web/src/klubhus/boardmenu.ts'
import type { BoardState } from '../../web/src/board/board.ts'
import type { BoardPost } from '../../shared/board.ts'

const post = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: '1', author: { sub: 'sub-9', name: 'Niels Ørbæk Chemnitz' }, title: null, body: 'Et opslag',
  createdAt: '2026-10-27T10:00:00.000Z', commentCount: 0, attachmentCount: 0,
  url: 'https://theta.test/grupper/1/opslag/1',
  lyttefest: null,
  ...over,
})

const state = (over: Partial<BoardState> = {}): BoardState =>
  ({ posts: [], cursor: null, groupUrl: null, busy: false, error: null, ...over })

const kinds = (s: BoardState) => menuItems(s).map(i => i.kind)

describe('rækkerne i menuen', () => {
  it('is the posts, and always a way back to the room', () => {
    const items = menuItems(state({ posts: [post({ title: 'Nyt møde' })] }))
    expect(items.map(i => i.kind)).toEqual(['post', 'close'])
    expect(items[0].label).toBe('Niels: Nyt møde')
  })

  it('names a post by its first line when it has no title', () => {
    expect(menuItems(state({ posts: [post({ body: 'På tirsdag' })] }))[0].label).toBe('Niels: På tirsdag')
  })

  it('shows a lyttefest as one, with the album underneath', () => {
    const items = menuItems(state({
      posts: [post({ lyttefest: { id: 1, artist: 'Kate Bush', title: 'The Kick Inside', coverUrl: null } })],
    }))
    expect(items[0].label).toBe('Niels: LYTTEFEST')
    expect(items[0].note).toBe('Kate Bush: The Kick Inside')
  })

  it('offers older posts only while there are some', () => {
    expect(kinds(state({ posts: [post()], cursor: 'c2' }))).toContain('more')
    expect(kinds(state({ posts: [post()] }))).not.toContain('more')
  })

  it('offers the way in to writing only once the group is known', () => {
    expect(kinds(state({ groupUrl: 'https://theta.test/grupper/1' }))).toEqual(['write', 'close'])
    expect(kinds(state())).toEqual(['close'])
  })

  it('is never empty, so there is always something to press', () => {
    expect(menuItems(state())).toHaveLength(1)
  })
})

describe('hvad der er på skærmen', () => {
  it('starts at the top while everything fits', () => {
    expect(windowStart(0, 4, 8)).toBe(0)
    expect(windowStart(3, 4, 8)).toBe(0)
  })

  it('follows the cursor down past the last row on screen', () => {
    expect(windowStart(5, 20, 5, 0)).toBe(1)
    expect(windowStart(19, 20, 5, 0)).toBe(15)
  })

  it('follows it back up past the first', () => {
    expect(windowStart(2, 20, 5, 10)).toBe(2)
  })

  it('leaves the window alone while the cursor is inside it', () => {
    expect(windowStart(11, 20, 5, 10)).toBe(10)
  })

  it('never scrolls past the last row', () => {
    expect(windowStart(19, 20, 5, 99)).toBe(15)
  })
})

describe('en linje i menuen', () => {
  it('leaves a line that fits alone, in the board\'s own type', () => {
    expect(fitLine('Nyt møde', 20)).toBe('NYT MØDE')
  })

  it('ends on a whole word and says it was cut', () => {
    expect(fitLine('Jeg fandt den her i en kasse på loftet', 20)).toBe('JEG FANDT DEN...')
  })

  it('cuts inside the word when the first one is longer than the line', () => {
    expect(fitLine('Rekommanderetbrevet', 10)).toBe('REKOMMA...')
  })

  it('squeezes the line breaks out of a post written in paragraphs', () => {
    expect(fitLine('Hej\n\nder', 20)).toBe('HEJ DER')
  })

  it('does not fall over on a line with no room in it', () => {
    expect(fitLine('Noget', 3)).toBe('NOG')
    expect(fitLine('', 20)).toBe('')
  })
})

describe('at gå op og ned i menuen', () => {
  it('moves one row at a time, either way', () => {
    expect(nextRow(2, 1, 6)).toBe(3)
    expect(nextRow(2, -1, 6)).toBe(1)
  })

  it('stays on the last row at the foot, and on the first at the head', () => {
    expect(nextRow(5, 1, 6)).toBe(5)
    expect(nextRow(0, -1, 6)).toBe(0)
  })

  it('does not come round from one end to the other', () => {
    // What it used to do, and what the crates used to do before them.
    expect(nextRow(5, 1, 6)).not.toBe(0)
    expect(nextRow(0, -1, 6)).not.toBe(5)
  })

  it('has nowhere to go in a menu of one', () => {
    expect(nextRow(0, 1, 1)).toBe(0)
    expect(nextRow(0, -1, 1)).toBe(0)
  })
})
