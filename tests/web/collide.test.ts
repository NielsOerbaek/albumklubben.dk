import { expect, test } from 'vitest'
import { moveWithCollision, type Box2 } from '../../web/src/ps1/collide.ts'

const R = 0.3

test('moves freely without boxes', () => {
  expect(moveWithCollision([1, 2], [0.5, -0.25], R, [])).toEqual([1.5, 1.75])
})

test('stops at a wall', () => {
  const wall: Box2 = { minX: 1, minZ: -5, maxX: 2, maxZ: 5 }
  const [x, z] = moveWithCollision([0, 0], [2, 0], R, [wall])
  expect(x).toBeLessThanOrEqual(1 - R)
  expect(z).toBe(0)
})

test('slides along a wall', () => {
  const wall: Box2 = { minX: 1, minZ: -5, maxX: 2, maxZ: 5 }
  const [x, z] = moveWithCollision([0.5, 0], [0.5, 0.5], R, [wall])
  expect(x).toBeLessThanOrEqual(1 - R)
  expect(z).toBeCloseTo(0.5)
})

test('never ends inside an expanded box', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const boxes: Box2[] = Array.from({ length: 5 }, () => {
    const x = rand() * 16 - 8, z = rand() * 16 - 8
    return { minX: x, minZ: z, maxX: x + 0.2 + rand() * 3, maxZ: z + 0.2 + rand() * 3 }
  })
  const inside = ([x, z]: [number, number]) =>
    boxes.some(b => x > b.minX - R && x < b.maxX + R && z > b.minZ - R && z < b.maxZ + R)
  let pos: [number, number] = [0, 0]
  while (inside(pos)) pos = [rand() * 20 - 10, rand() * 20 - 10]
  for (let i = 0; i < 1000; i++) {
    pos = moveWithCollision(pos, [rand() * 4 - 2, rand() * 4 - 2], R, boxes)
    expect(inside(pos)).toBe(false)
  }
})
