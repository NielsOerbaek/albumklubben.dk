import { expect, test } from 'vitest'
import { project } from '../../shared/projection.ts'

test('world corners map to 0 and 100', () => {
  expect(project('world', 84, -180)).toEqual({ x: 0, y: 0 })
  expect(project('world', -58, 180)).toEqual({ x: 100, y: 100 })
})

test('Copenhagen sits in the middle-right of the Denmark view', () => {
  const p = project('denmark', 55.676, 12.568)!
  expect(p.x).toBeGreaterThan(60)
  expect(p.x).toBeLessThan(70)
  expect(p.y).toBeGreaterThan(60)
  expect(p.y).toBeLessThan(70)
})

test('London is outside the Denmark view', () => {
  expect(project('denmark', 51.5, -0.13)).toBeNull()
})
