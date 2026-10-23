"""Regenerate web/public/maps/{world,denmark}.svg from Natural Earth v5.1.2.

Run: python3 -I tools/make_maps.py
The projection matches shared/projection.ts (equirectangular; Denmark x-scaled by cos 56 deg).
"""
import json
import math
import urllib.request
from pathlib import Path

BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/'
OUT = Path(__file__).resolve().parent.parent / 'web' / 'public' / 'maps'
VIEWS = {
    'world': dict(west=-180, east=180, north=84, south=-58, xscale=1.0, width=1000),
    'denmark': dict(west=7.9, east=15.3, north=57.8, south=54.5, xscale=math.cos(math.radians(56)), width=1000),
}


def fetch(name):
    with urllib.request.urlopen(BASE + name, timeout=120) as r:
        return json.load(r)


def polygons(geometry):
    if geometry['type'] == 'Polygon':
        return [geometry['coordinates']]
    if geometry['type'] == 'MultiPolygon':
        return geometry['coordinates']
    return []


def simplify(points, tol):
    """Ramer-Douglas-Peucker on a list of (x, y)."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy)
    best, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = math.hypot(px - x1, py - y1) if norm == 0 else abs(dy * (px - x1) - dx * (py - y1)) / norm
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [points[0], points[-1]]
    return simplify(points[: idx + 1], tol)[:-1] + simplify(points[idx:], tol)


def build(view, features, tol):
    v = VIEWS[view]
    w = (v['east'] - v['west']) * v['xscale']
    h = v['north'] - v['south']
    width = v['width']
    height = round(width * h / w, 1)
    sx, sy = width / (v['east'] - v['west']), height / h
    paths = []
    for f in features:
        for poly in polygons(f['geometry']):
            for ring in poly:
                pts = [((lng - v['west']) * sx, (v['north'] - lat) * sy) for lng, lat in ring]
                if not any(-5 <= x <= width + 5 and -5 <= y <= height + 5 for x, y in pts):
                    continue
                pts = simplify(pts, tol)
                if len(pts) < 4:
                    continue
                paths.append('M' + 'L'.join(f'{x:.1f} {y:.1f}'.replace('.0 ', ' ').removesuffix('.0') for x, y in pts) + 'Z')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
           f'preserveAspectRatio="none"><path fill="#2a2d34" stroke="#3a3d44" stroke-width="{1 if view == "world" else 1.5}" '
           f'stroke-linejoin="round" d="{"".join(paths)}"/></svg>')
    (OUT / f'{view}.svg').write_text(svg)
    print(view, len(svg), 'bytes')


OUT.mkdir(parents=True, exist_ok=True)
build('world', fetch('ne_50m_land.geojson')['features'], 0.6)
dk = [f for f in fetch('ne_10m_admin_0_countries.geojson')['features'] if f['properties'].get('ADM0_A3') == 'DNK']
build('denmark', dk, 0.8)
