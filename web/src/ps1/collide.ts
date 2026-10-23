export type Box2 = { minX: number; minZ: number; maxX: number; maxZ: number }

/** Clamps a move along one axis against every box that overlaps the other axis.
 *  Swept, so a large step cannot tunnel through a thin wall. */
function sweep(from: number, to: number, other: number, axis: 'x' | 'z', r: number, boxes: Box2[]) {
  for (const b of boxes) {
    const [lo, hi, oLo, oHi] = axis === 'x'
      ? [b.minX - r, b.maxX + r, b.minZ - r, b.maxZ + r]
      : [b.minZ - r, b.maxZ + r, b.minX - r, b.maxX + r]
    if (other <= oLo || other >= oHi) continue
    if (to > from && from <= lo && to > lo) to = lo
    else if (to < from && from >= hi && to < hi) to = hi
  }
  return to
}

/** Moves a circle of `radius` by `delta`, resolving X then Z so it slides along walls. */
export function moveWithCollision(
  pos: [number, number], delta: [number, number], radius: number, boxes: Box2[],
): [number, number] {
  const x = sweep(pos[0], pos[0] + delta[0], pos[1], 'x', radius, boxes)
  const z = sweep(pos[1], pos[1] + delta[1], x, 'z', radius, boxes)
  return [x, z]
}
