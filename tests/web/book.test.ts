import { describe, expect, it } from 'vitest'
import { bookSpreads, PAGE_ASPECT, posterCells } from '../../web/src/klubhus/book.ts'
import type { Meeting, Poster } from '../../shared/types.ts'

const posters = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, position: i + 1 } as Poster))
const meeting = (number: number, n: number): Meeting =>
  ({ id: number, number, date: null, time: null, theme: null, albums: [], posters: posters(n) })

describe('bookSpreads', () => {
  it('orders spreads newest meeting first and leaves out meetings without posters', () => {
    const s = bookSpreads([meeting(1, 1), meeting(2, 0), meeting(3, 2)])
    expect(s.map((x) => x.meeting.number)).toEqual([3, 1])
    expect(bookSpreads([meeting(3, 1), meeting(1, 1), meeting(2, 1)]).map((x) => x.meeting.number)).toEqual([3, 2, 1])
  })

  it("splits a meeting's posters by position into spreads of four, marking the rest continued", () => {
    const s = bookSpreads([meeting(5, 9)])
    expect(s.map((x) => x.posters.map((p) => p.position))).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]])
    expect(s.map((x) => x.continued)).toEqual([false, true, true])
  })

  it('returns no spreads for a club with no posters', () => {
    expect(bookSpreads([])).toEqual([])
    expect(bookSpreads([meeting(1, 0)])).toEqual([])
  })
})

describe('posterCells', () => {
  it('places 1, 2, 3 and 4 posters of mixed aspects without overlap, inside the margins, each keeping its aspect', () => {
    const all = [1.4, 0.7, 1.0, 2.0]
    for (let n = 1; n <= 4; n++) {
      const aspects = all.slice(0, n)
      const cells = posterCells(aspects)
      expect(cells).toHaveLength(n)
      cells.forEach((c, i) => {
        expect(c.w).toBeGreaterThan(0.1)
        expect(c.x).toBeGreaterThan(0)
        expect(c.y).toBeGreaterThan(0)
        expect(c.x + c.w).toBeLessThan(1)
        expect(c.y + c.h).toBeLessThan(PAGE_ASPECT)
        expect(Math.abs(c.h / c.w / aspects[i] - 1)).toBeLessThan(0.01)
        cells.slice(i + 1).forEach((d) => {
          const apart = c.x + c.w <= d.x || d.x + d.w <= c.x || c.y + c.h <= d.y || d.y + d.h <= c.y
          expect(apart).toBe(true)
        })
      })
    }
  })
})
