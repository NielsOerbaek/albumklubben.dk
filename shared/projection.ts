export type MapView = 'world' | 'denmark'

export const MAP_BOUNDS: Record<MapView, { west: number; east: number; north: number; south: number }> = {
  world: { west: -180, east: 180, north: 84, south: -58 },
  denmark: { west: 7.9, east: 15.3, north: 57.8, south: 54.5 },
}

/** Denmark is stretched horizontally by cos(56°) so shapes look right at that latitude. */
export const DENMARK_SCALE = Math.cos((56 * Math.PI) / 180)

/** Width / height of each map's SVG viewBox. */
export function mapAspect(view: MapView): number {
  const b = MAP_BOUNDS[view]
  const w = b.east - b.west
  return (view === 'denmark' ? w * DENMARK_SCALE : w) / (b.north - b.south)
}

/** Equirectangular position as percentages of the map, or null outside the bounds. */
export function project(view: MapView, lat: number, lng: number): { x: number; y: number } | null {
  const b = MAP_BOUNDS[view]
  if (lat > b.north || lat < b.south || lng < b.west || lng > b.east) return null
  return {
    x: ((lng - b.west) / (b.east - b.west)) * 100,
    y: ((b.north - lat) / (b.north - b.south)) * 100,
  }
}
