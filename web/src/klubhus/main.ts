import * as THREE from 'three'
import { render } from 'lit-html'
import '../base.css'
import './klubhus.css'
import { fetchArchive } from '../api.ts'
import { albumDialog } from '../album.ts'
import { posterDialog } from '../poster.ts'
import { topBarTemplate } from '../topbar.ts'
import { createPs1Renderer } from '../ps1/renderer.ts'
import { createWalkControls } from '../ps1/controls.ts'
import { FIRST_HINT, showHint, showOverlay, showPrompt, smallScreenGuard } from '../ps1/hud.ts'
import { buildClubLayout } from './layout.ts'
import { bookSpreads } from './book.ts'
import { buildClub, type CrateView } from './scene.ts'
import type { Album, Meeting, Poster } from '../../../shared/types.ts'

const REACH = 1.4 // metres from a crate's centre
const FACING = Math.cos(THREE.MathUtils.degToRad(35))
const PROMPT = 'Klik eller scroll for at bladre · E for at tage pladen op'
const AGAIN = 'Klik for at gå videre'

render(topBarTemplate('klubhus'), document.getElementById('app')!)
const canvas = document.querySelector<HTMLCanvasElement>('canvas.ps1-canvas')!
if (smallScreenGuard()) canvas.remove()
else start().catch((err) => { console.error(err); showHint('Klubhuset kunne ikke åbne. Prøv at genindlæse siden.') })

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
  const layout = buildClubLayout(archive.meetings)
  const club = await buildClub(layout, bookSpreads(archive.meetings))
  const meetingById = new Map(archive.meetings.map((m) => [m.id, m]))

  const { render: draw } = createPs1Renderer(canvas)
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40)
  camera.position.set(layout.spawn.x, 0, layout.spawn.z)
  camera.rotation.set(-0.12, layout.spawn.yaw, 0, 'YXZ')
  const controls = createWalkControls(camera, canvas, { boxes: layout.boxes })

  // What you aim at: a crate in reach.
  let target: CrateView | null = null
  // The open dialogs: a poster, an album over it (or a record pulled from a crate), or both.
  let poster: { poster: Poster; meeting: Meeting } | null = null
  let pulled: { album: Album; showTracks: boolean } | null = null
  let entered = false
  const open = () => !!(poster || pulled)

  const walking = (on: boolean) => document.body.classList.toggle('walking', on)
  controls.onLockChange((locked) => {
    walking(locked)
    entered ||= locked
    showPrompt(locked || open() || !entered ? null : AGAIN)
    // The first locked frame may come before this event; aim afresh so the prompt comes back.
    target = null
  })

  function drawOverlay() {
    if (pulled) {
      const { album, showTracks } = pulled
      return showOverlay(albumDialog({
        album, showTracks, meetingNumber: meetingById.get(album.meetingId)!.number,
        help: poster ? 'Esc for at gå tilbage til plakaten' : 'Esc for at lægge den tilbage',
        onToggle: () => { pulled!.showTracks = !pulled!.showTracks; drawOverlay() },
        onClose: closeAll,
        onBack: poster ? closeTop : undefined,
      }))
    }
    if (poster) {
      return showOverlay(posterDialog({
        poster: poster.poster,
        meeting: poster.meeting,
        onAlbum: (album) => { pulled = { album, showTracks: false }; drawOverlay() },
        onClose: closeAll,
      }))
    }
    showOverlay(null)
  }

  function openDialog() {
    showPrompt(null)
    controls.unlock()
    drawOverlay()
  }

  function pullOut() {
    const album = target?.frontAlbum()
    if (!album) return
    pulled = { album, showTracks: false }
    openDialog()
  }

  function openPoster(p: Poster) {
    poster = { poster: p, meeting: meetingById.get(p.meetingId)! }
    openDialog()
  }

  /** Esc and Tilbage: the album goes back to its poster; the last dialog closes. */
  function closeTop() {
    if (pulled) pulled = null
    else poster = null
    drawOverlay()
    if (!open()) showPrompt(AGAIN)
  }

  function closeAll() {
    pulled = poster = null
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
    if (e.code === 'KeyE' && controls.isLocked()) pullOut()
    else if (e.code === 'Escape' && open()) closeTop()
  })

  showHint(FIRST_HINT)
  let last = performance.now()
  requestAnimationFrame(function loop(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1)
    last = now
    controls.update(dt)
    club.update(dt, camera.position)
    const locked = controls.isLocked()
    if (locked) {
      const crate = crateInView(club.crates, camera)
      if (crate !== target) showPrompt(crate ? PROMPT : null)
      target = crate
    } else target = null
    draw(club.scene, camera)
    requestAnimationFrame(loop)
  })

  // For the screenshot script and the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __club: {
    camera, controls, club, layout, book: club.book,
    pullOut: (c: CrateView) => { target = c; pullOut() },
    openPoster,
  } })
}
