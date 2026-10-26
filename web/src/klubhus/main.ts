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

type Pose = { position: THREE.Vector3; yaw: number; pitch: number }

const REACH = 1.4 // metres from a crate's centre
const FACING = Math.cos(THREE.MathUtils.degToRad(35))
const PROMPT = 'Klik eller scroll for at bladre · E for at tage pladen op'
const AGAIN = 'Klik for at gå videre'
const BOOK_SHUT = 'Klik eller E for at åbne plakatbogen'
const BOOK_OPEN = 'Klik på en plakat for at se den · A/D eller pilene for at bladre · Esc for at lukke'
const BOOK_REACH = 1.6 // metres on the floor plan from the book's centre
const EASE_TIME = 0.5 // seconds, to the open book and back
// The look while reading, around the view pose: it sits close over the spread and looks steeply
// down, so reaching the covers at a page's outer edge takes a wide yaw.
const LOOK = { yaw: 1.1, down: 0.28, up: 0.47 }

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

const shown = (o: THREE.Object3D): boolean => o.visible && (!o.parent || shown(o.parent))
const smooth = (t: number) => t * t * (3 - 2 * t)
/** `a` turned the short way round towards `b`. */
const towards = (a: number, b: number) => a + THREE.MathUtils.euclideanModulo(b - a + Math.PI, 2 * Math.PI) - Math.PI

async function start() {
  showHint('Henter pladerne')
  const archive = await fetchArchive()
  const layout = buildClubLayout(archive.meetings)
  const club = await buildClub(layout, bookSpreads(archive.meetings))
  const meetingById = new Map(archive.meetings.map((m) => [m.id, m]))
  const book = club.book

  const { render: draw } = createPs1Renderer(canvas)
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40)
  camera.position.set(layout.spawn.x, 0, layout.spawn.z)
  camera.rotation.set(-0.12, layout.spawn.yaw, 0, 'YXZ')
  const controls = createWalkControls(camera, canvas, { boxes: layout.boxes })

  // What you aim at: a crate in reach, or else the shut book.
  let target: CrateView | null = null
  let bookAimed = false
  // The open dialogs: a poster, an album over it (or a record pulled from a crate), or both.
  let poster: { poster: Poster; meeting: Meeting } | null = null
  let pulled: { album: Album; showTracks: boolean } | null = null
  let entered = false
  const open = () => !!(poster || pulled)
  // Where you stood before opening the book, and the camera's ease to the book or back to it.
  let standing: Pose | null = null
  let ease: { from: Pose; to: Pose; t: number; done: () => void } | null = null

  let prompted: string | null = null
  const prompt = (text: string | null) => { if (text !== prompted) showPrompt(prompted = text) }

  const ray = new THREE.Raycaster()
  const centreRay = () => {
    camera.updateMatrixWorld()
    ray.setFromCamera(new THREE.Vector2(0, 0), camera)
    return ray
  }
  /** Within reach of the shut book, the view's centre on it. */
  const bookInView = () => Math.hypot(layout.book.x - camera.position.x, layout.book.z - camera.position.z) <= BOOK_REACH
    && centreRay().intersectObject(book.object).some((h) => shown(h.object))

  const pose = (): Pose => ({ position: camera.position.clone(), yaw: camera.rotation.y, pitch: camera.rotation.x })
  const easeTo = (to: Pose, done: () => void) => { ease = { from: pose(), to, t: 0, done } }

  function openBook() {
    if (book.isOpen() || ease) return
    standing = pose()
    const v = book.viewPose()
    const to = { position: v.position, yaw: towards(standing.yaw, v.yaw), pitch: v.pitch }
    book.open()
    controls.setMovement(false)
    target = null
    bookAimed = false
    prompt(BOOK_OPEN)
    easeTo(to, () => controls.setLookRange({
      yaw: [to.yaw - LOOK.yaw, to.yaw + LOOK.yaw], pitch: [to.pitch - LOOK.down, to.pitch + LOOK.up],
    }))
  }

  /** Back to where you stood; the book shuts once you are there. */
  function closeBook() {
    if (!book.isOpen() || ease || !standing) return
    controls.setLookRange(null)
    easeTo(standing, () => {
      book.close()
      controls.setMovement(true)
      standing = null
      prompt(controls.isLocked() ? null : AGAIN)
    })
  }

  /** A click on the open book: the poster or album at the view's centre. */
  function clickBook() {
    const hit = book.aim(centreRay())
    if (hit?.kind === 'poster') poster = { poster: hit.poster, meeting: hit.meeting }
    else if (hit?.kind === 'album') pulled = { album: hit.album, showTracks: false }
    else return
    openDialog()
  }

  const walking = (on: boolean) => document.body.classList.toggle('walking', on)
  controls.onLockChange((locked) => {
    walking(locked)
    entered ||= locked
    prompt(locked || open() || !entered ? null : AGAIN) // a locked frame puts the aim's prompt back
    // Esc while reading: the browser takes the key and only releases the mouse, so losing the lock
    // closes the book. Our own unlock opens a dialog first, so `open()` tells it apart. Leaving the
    // tab or window also releases the mouse and keeps the book open; wait a moment for the blur.
    if (!locked && book.isOpen() && !open()) setTimeout(() => {
      if (!controls.isLocked() && !open() && !document.hidden && document.hasFocus()) closeBook()
    }, 100)
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
    prompt(null)
    controls.unlock()
    drawOverlay()
  }

  function pullOut() {
    const album = target?.frontAlbum()
    if (!album) return
    pulled = { album, showTracks: false }
    openDialog()
  }

  /** Esc and Tilbage: the album goes back to its poster; the last dialog closes. */
  function closeTop() {
    if (pulled) pulled = null
    else poster = null
    drawOverlay()
    if (!open()) prompt(AGAIN)
  }

  function closeAll() {
    pulled = poster = null
    drawOverlay()
    prompt(AGAIN)
  }

  // Click flips, a double click pulls out the record the first click flipped past.
  // On the book, a click opens it, or opens the poster or album you point at.
  let clickFlipped: CrateView | null = null
  canvas.addEventListener('click', (e) => {
    if (!controls.isLocked() || e.detail > 1 || ease) return
    if (book.isOpen()) return clickBook()
    if (bookAimed) return openBook()
    clickFlipped = target
    target?.flip(1)
  })
  canvas.addEventListener('dblclick', () => {
    if (!controls.isLocked() || !target) return
    if (clickFlipped === target) target.flip(-1)
    pullOut()
  })

  // A notch of a mouse wheel is one record or page; a trackpad's small deltas add up to one.
  let wheel = 0
  let lastFlip = 0
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const reading = book.isOpen() && !ease
    if (!controls.isLocked() || !(target || reading)) return
    wheel += e.deltaY
    const now = performance.now()
    if (Math.abs(wheel) < 40 || now - lastFlip < 90) return
    const dir = wheel > 0 ? 1 : -1
    if (reading) book.turn(dir)
    else target?.flip(dir)
    wheel = 0
    lastFlip = now
  }, { passive: false })

  const PAGE_KEYS: Record<string, 1 | -1> = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1 }
  document.addEventListener('keydown', (e) => {
    if (ease) return
    const locked = controls.isLocked()
    if (e.code === 'Escape') {
      // One Esc does one thing: it closes a dialog, or else the book (when the browser let us see it).
      if (open()) closeTop()
      else if (book.isOpen() && !locked) closeBook()
    } else if (book.isOpen()) {
      if (locked && PAGE_KEYS[e.code]) book.turn(PAGE_KEYS[e.code])
    } else if (e.code === 'KeyE' && locked) {
      if (target) pullOut()
      else if (bookAimed) openBook()
    }
  })

  showHint(FIRST_HINT)
  let last = performance.now()
  requestAnimationFrame(function loop(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1)
    last = now
    controls.update(dt)
    if (ease) {
      const e = ease
      e.t = Math.min(1, e.t + dt / EASE_TIME)
      const k = smooth(e.t)
      controls.setPose(e.from.position.clone().lerp(e.to.position, k),
        THREE.MathUtils.lerp(e.from.yaw, e.to.yaw, k), THREE.MathUtils.lerp(e.from.pitch, e.to.pitch, k))
      if (e.t >= 1) { ease = null; e.done() }
    }
    club.update(dt, camera.position)
    if (controls.isLocked() && !ease) {
      if (book.isOpen()) prompt(BOOK_OPEN)
      else {
        // The crates come first when both are in view.
        target = crateInView(club.crates, camera)
        bookAimed = !target && bookInView()
        prompt(target ? PROMPT : bookAimed ? BOOK_SHUT : null)
      }
    } else if (!ease) { target = null; bookAimed = false }
    draw(club.scene, camera)
    requestAnimationFrame(loop)
  })

  // For the screenshot script and the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __club: {
    camera, controls, club, layout, book,
    pullOut: (c: CrateView) => { target = c; pullOut() },
    /** What a click on the open book would open now. */
    aim: () => book.aim(centreRay()),
  } })
}
