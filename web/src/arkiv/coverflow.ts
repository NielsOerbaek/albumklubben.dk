import { html, type TemplateResult } from 'lit-html'
import { repeat } from 'lit-html/directives/repeat.js'
import { albumTemplate } from '../album.ts'
import { thumbUrl } from '../api.ts'
import { filtered, recentLabel, recentYears, type Filter } from './filters.ts'
import type { Actions, Entry, State } from './main.ts'
import './coverflow.css'

/** Px from the centre cover to the first side cover. */
export const CENTRE_GAP = 190
/** Px between side covers in the stacks. */
export const SIDE_STEP = 46
/** Px the side covers sit behind the centre one. */
export const SIDE_DEPTH = 160

/** Covers drawn either side of the centre. */
const WINDOW = 15
const TURN = 70
/** Wheel or trackpad delta that moves one cover, and the shortest time between such moves. */
const WHEEL_STEP = 40
const WHEEL_GAP_MS = 90
/** Px of dragging that moves one cover. */
const DRAG_STEP = 60

/** Where a cover sits; `offset` is its index minus the centre's. */
export function coverPose(offset: number): { x: number; z: number; rotateY: number; zIndex: number } {
  const zIndex = 1000 - Math.abs(offset)
  if (offset === 0) return { x: 0, z: 0, rotateY: 0, zIndex }
  const side = Math.sign(offset)
  return { x: side * (CENTRE_GAP + (Math.abs(offset) - 1) * SIDE_STEP), z: -SIDE_DEPTH, rotateY: -side * TURN, zIndex }
}

const label = (a: { artist: string; title: string }) => `${a.artist}, ${a.title}`

// Input state lives across renders.
let wheelSum = 0
let lastWheelMove = 0
let drag: { x: number; sum: number; moved: boolean } | null = null
let dragged = false

function controls(s: State, act: Actions): TemplateResult {
  const recent = recentYears(s.entries)
  const chips: [Filter, string][] = [
    ['alle', `Alle ${s.entries.length}`], ['nostalgi', 'Nostalgialbums'], ['dk', 'Danske'], ['old', 'Før 2000'],
  ]
  if (recent.length) chips.push(['recent', recentLabel(recent)])
  const pick = (filter: Filter) => {
    const list = filtered(s.entries, filter)
    const keep = list.some((e) => e.album.id === s.selId)
    act.set(keep ? { filter } : { filter, selId: list.at(-1)?.album.id ?? s.selId, showTracks: false })
  }
  return html`<div class="cf-controls">
    <div class="chips"><span class="muted">Vis</span>
      ${chips.map(([id, text]) =>
        html`<button class="pill ${s.filter === id ? 'on' : ''}" aria-pressed=${s.filter === id}
          @click=${() => pick(id)}>${text}</button>`)}
    </div>
    <button class="pill outline" @click=${act.surprise}>Overrask mig</button>
  </div>`
}

function cover(e: Entry, offset: number, onClick: (ev: MouseEvent) => void): TemplateResult {
  const p = coverPose(offset)
  const { album } = e
  return html`<button class="cf-cover" tabindex="-1" aria-label=${label(album)}
    aria-current=${offset === 0 ? 'true' : 'false'} @click=${onClick}
    style="transform:translateX(${p.x}px) translateZ(${p.z}px) rotateY(${p.rotateY}deg);z-index:${p.zIndex}">
    ${album.coverUrl
      ? html`<img src=${thumbUrl(album.coverUrl, 512)} alt="" draggable="false">`
      : html`<span class="cf-nocover">${album.artist}<br>${album.title}</span>`}
  </button>`
}

/** Hylden: the archive as an iTunes 7 style Cover Flow, with the centred album below. */
export function coverflowView(s: State, act: Actions): TemplateResult {
  const list = filtered(s.entries, s.filter)
  if (!list.length) {
    return html`<div class="cf-below">${controls(s, act)}<p class="note">Ingen albums passer til filteret.</p></div>`
  }
  const found = list.findIndex((e) => e.album.id === s.selId)
  const idx = found < 0 ? list.length - 1 : found
  const centre = list[idx]
  const go = (i: number) => {
    const j = Math.min(list.length - 1, Math.max(0, i))
    if (j !== idx) act.select(list[j].album.id)
  }

  const onKey = (e: KeyboardEvent) => {
    dragged = false // a drag's click never came; let Enter or Space on a cover through
    if (e.target instanceof HTMLInputElement) return // the slider handles its own keys
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (!step) return
    e.preventDefault()
    go(idx + step)
  }
  const onWheel = {
    passive: false,
    handleEvent(e: WheelEvent) {
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1
      const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit
      if (!d) return
      const dir = Math.sign(d)
      // At either end the wheel scrolls the page as usual.
      if (idx + dir < 0 || idx + dir >= list.length) { wheelSum = 0; return }
      e.preventDefault()
      if (Math.sign(wheelSum) !== dir) wheelSum = 0
      wheelSum += d
      const now = performance.now()
      if (Math.abs(wheelSum) >= WHEEL_STEP && now - lastWheelMove >= WHEEL_GAP_MS) {
        wheelSum = 0
        lastWheelMove = now
        go(idx + dir)
      }
    },
  }
  const onDown = (e: PointerEvent) => {
    dragged = false
    if (e.button === 0) drag = { x: e.clientX, sum: 0, moved: false }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    if (!(e.buttons & 1)) { drag = null; return } // released outside the band
    drag.sum += e.clientX - drag.x
    drag.x = e.clientX
    if (!drag.moved && Math.abs(drag.sum) > 6) {
      drag.moved = true
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    }
    const steps = Math.trunc(drag.sum / DRAG_STEP)
    if (steps) {
      drag.sum -= steps * DRAG_STEP
      go(idx - steps) // dragging left brings the next cover in
    }
  }
  const onUp = () => {
    dragged = !!drag?.moved
    drag = null
  }
  const lo = Math.max(0, idx - WINDOW)
  const shown = list.slice(lo, idx + WINDOW + 1)
  const { album } = centre

  return html`<div class="cf-band" tabindex="0" role="group" aria-roledescription="karrusel"
      aria-label="Albums. Brug piletasterne til at bladre." @keydown=${onKey} @wheel=${onWheel}>
      <div class="cf-stage" @pointerdown=${onDown} @pointermove=${onMove} @pointerup=${onUp} @pointercancel=${onUp}>
        ${repeat(shown, (e) => e.album.id, (e, k) => cover(e, lo + k - idx, (ev) => {
          // Keep focus on the band, so the arrow keys work and no ring lands on a side cover.
          ;(ev.currentTarget as HTMLElement).closest<HTMLElement>('.cf-band')?.focus({ preventScroll: true })
          if (dragged) { dragged = false; return }
          go(lo + k)
        }))}
      </div>
      <p class="cf-caption"><span class="cf-title">${album.title}</span><span class="cf-artist">${album.artist}</span></p>
      <input class="cf-slider" type="range" min="0" max=${list.length - 1} step="1" .value=${String(idx)}
        aria-label="Bladr i albums" aria-valuetext=${label(album)}
        @input=${(e: Event) => go(Number((e.target as HTMLInputElement).value))}>
    </div>
    <div class="cf-below">
      ${controls(s, act)}
      ${albumTemplate({ album, meetingNumber: centre.n, showTracks: s.showTracks,
        onToggle: () => act.set({ showTracks: !s.showTracks }) })}
    </div>`
}
