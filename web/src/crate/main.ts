import * as THREE from 'three'
import { render } from 'lit-html'
import '../base.css'
import './crate.css'
import { fetchArchive } from '../api.ts'
import { recordOverlay } from '../record.ts'
import { topBarTemplate } from '../topbar.ts'
import { createPs1Renderer } from '../ps1/renderer.ts'
import { createWalkControls } from '../ps1/controls.ts'
import { FIRST_HINT, showHint, showOverlay, showPrompt, smallScreenGuard } from '../ps1/hud.ts'
import { buildShopLayout } from './layout.ts'
import { buildShop, type CrateView } from './scene.ts'
import type { Album } from '../../../shared/types.ts'

const REACH = 1.4 // metres from a crate's centre
const FACING = Math.cos(THREE.MathUtils.degToRad(35))
const PROMPT = 'Klik eller scroll for at bladre · E for at tage pladen op'
const AGAIN = 'Klik for at gå videre'

render(topBarTemplate('crate'), document.getElementById('app')!)
const canvas = document.querySelector<HTMLCanvasElement>('canvas.ps1-canvas')!
if (smallScreenGuard()) canvas.remove()
else start().catch((err) => { console.error(err); showHint('Butikken kunne ikke åbne. Prøv at genindlæse siden.') })

/** The crate in reach that you look most squarely at, from its front side. */
function crateInView(crates: CrateView[], camera: THREE.PerspectiveCamera): CrateView | null {
  const look = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize()
  let best: CrateView | null = null
  let bestDot = FACING
  for (const c of crates) {
    const to = new THREE.Vector3(c.centre.x - camera.position.x, 0, c.centre.z - camera.position.z)
    const dist = to.length()
    if (dist > REACH || dist < 1e-3) continue
    // The crate's front faces +Z turned by its rotation; you have to stand on that side.
    const front = new THREE.Vector3(Math.sin(c.spec.rotationY), 0, Math.cos(c.spec.rotationY))
    if (front.dot(to) > 0) continue
    const dot = look.dot(to.normalize())
    if (dot > bestDot) { best = c; bestDot = dot }
  }
  return best
}

async function start() {
  showHint('Henter pladerne')
  const archive = await fetchArchive()
  const layout = buildShopLayout(archive.meetings)
  const shop = await buildShop(layout, archive.meetings.flatMap((m) => m.posters))
  const meetingNumber = new Map(archive.meetings.map((m) => [m.id, m.number]))

  const { render: draw } = createPs1Renderer(canvas)
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40)
  camera.position.set(layout.spawn.x, 0, layout.spawn.z)
  camera.rotation.set(-0.12, layout.spawn.yaw, 0, 'YXZ')
  const controls = createWalkControls(camera, canvas, { boxes: layout.boxes })

  let target: CrateView | null = null
  let pulled: { album: Album; flipped: boolean } | null = null
  let entered = false

  const walking = (on: boolean) => document.body.classList.toggle('walking', on)
  controls.onLockChange((locked) => {
    walking(locked)
    entered ||= locked
    showPrompt(locked || pulled || !entered ? null : AGAIN)
  })

  function drawOverlay() {
    if (!pulled) return showOverlay(null)
    const { album, flipped } = pulled
    showOverlay(recordOverlay({
      album, flipped, meetingNumber: meetingNumber.get(album.meetingId)!,
      help: 'Klik på pladen for at vende den · Esc for at lægge den tilbage',
      onTurn: () => { pulled!.flipped = !pulled!.flipped; drawOverlay() },
      onClose: putBack,
    }))
  }

  function pullOut() {
    const album = target?.frontAlbum()
    if (!album) return
    pulled = { album, flipped: false }
    showPrompt(null)
    controls.unlock()
    drawOverlay()
  }

  function putBack() {
    pulled = null
    drawOverlay()
    showPrompt(AGAIN)
  }

  // Click flips, a double click pulls out the record the first click flipped past.
  let clickFlipped: CrateView | null = null
  canvas.addEventListener('click', (e) => {
    if (!controls.isLocked() || e.detail > 1) return
    clickFlipped = target
    target?.flip(1)
  })
  canvas.addEventListener('dblclick', () => {
    if (!controls.isLocked() || !target) return
    if (clickFlipped === target) target.flip(-1)
    pullOut()
  })

  // A notch of a mouse wheel is one record; a trackpad's small deltas add up to one.
  let wheel = 0
  let lastFlip = 0
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (!controls.isLocked() || !target) return
    wheel += e.deltaY
    const now = performance.now()
    if (Math.abs(wheel) < 40 || now - lastFlip < 90) return
    target.flip(wheel > 0 ? 1 : -1)
    wheel = 0
    lastFlip = now
  }, { passive: false })

  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && controls.isLocked() && target) pullOut()
    else if (e.code === 'Escape' && pulled) putBack()
  })

  showHint(FIRST_HINT)
  let last = performance.now()
  requestAnimationFrame(function loop(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1)
    last = now
    controls.update(dt)
    shop.update(dt)
    if (controls.isLocked()) {
      const next = crateInView(shop.crates, camera)
      if (next !== target) showPrompt(next ? PROMPT : null)
      target = next
    } else target = null
    draw(shop.scene, camera)
    requestAnimationFrame(loop)
  })

  // For the screenshot script and the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __crate: { camera, controls, shop, layout, pullOut: (c: CrateView) => { target = c; pullOut() } } })
}
