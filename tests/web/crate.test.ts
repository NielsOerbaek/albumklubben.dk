// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { nextFront } from '../../web/src/klubhus/scene.ts'

describe('at bladre i kassen', () => {
  it('moves one record at a time, either way', () => {
    expect(nextFront(2, 1, 6)).toBe(3)
    expect(nextFront(2, -1, 6)).toBe(1)
  })

  it('stays on the last record at the back of the crate', () => {
    expect(nextFront(5, 1, 6)).toBe(5)
  })

  it('stays on the first one at the front', () => {
    expect(nextFront(0, -1, 6)).toBe(0)
  })

  it('does not come round from one end to the other', () => {
    // What it used to do, and the thing that lost you your place in a full crate.
    expect(nextFront(5, 1, 6)).not.toBe(0)
    expect(nextFront(0, -1, 6)).not.toBe(5)
  })

  it('has nowhere to go in a crate holding one record', () => {
    expect(nextFront(0, 1, 1)).toBe(0)
    expect(nextFront(0, -1, 1)).toBe(0)
  })
})
