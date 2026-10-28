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
import { FIRST_HINT, showHint, showOverlay, showPrompt, showReticle, smallScreenGuard } from '../ps1/hud.ts'
import { buildClubLayout } from './layout.ts'
import { bookSpreads } from './book.ts'
import { buildClub, type CrateView } from './scene.ts'
import { BOARD_REACH } from './corkboard.ts'
import { BOARD, boardLines, festLines, type SignFest } from './flipsign.ts'
import { createBoard } from '../board/board.ts'
import { createBoardMenu } from './boardmenu.ts'
import { loadMe } from '../me.ts'
import { createLyttefestPanel } from '../lyttefest/start.ts'
import type { Album, Meeting, Poster } from '../../../shared/types.ts'

type Pose = { position: THREE.Vector3; yaw: number; pitch: number }

const REACH = 1.4 // metres from a crate's centre
const FACING = Math.cos(THREE.MathUtils.degToRad(35))
const PROMPT = 'Klik eller scroll for at bladre · E for at tage pladen op'
const AGAIN = 'Klik for at gå videre'
const BOOK_SHUT = 'Klik eller E for at åbne plakatbogen'
const CORK = 'Klik for at læse opslagstavlen'
const CORK_EVERY = 60_000 // the board looks for new posts this often, while the tab is watched
const SIGN_EVERY = 20_000 // and the screen asks whether a lyttefest is on
const BOOK_OPEN = 'Klik på en plakat for at se den · A/D eller pilene for at bladre · Esc for at lukke'
const BOOK_REACH = 1.6 // metres on the floor plan from the book's centre
const EASE_TIME = 0.5 // seconds, to the open book and back
// The look while reading, around the view pose: enough to aim at every poster and cover on a spread.
const LOOK = { yaw: 0.55, down: 0.2, up: 0.28 }
const CENTRE = new THREE.Vector2(0, 0) // the view's centre, for the aim ray

/** Set by `start()`: the prompt goes back up when the board is closed, however it was closed. */
let afterBoard = () => {}
const board = createBoard(() => menu.draw())
/** The board close up, drawn like the room rather than over it. See `boardmenu.ts`. */
const menu = createBoardMenu({ board, onClose: () => afterBoard() })
const drawBar = () => render(topBarTemplate('klubhus'), document.getElementById('app')!)
drawBar()
void loadMe(drawBar)
/** Replaced by `start()` once the room is up, which is the only place it is opened from. */
let openBoard = () => { menu.open() }
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
  const spreads = bookSpreads(archive.meetings)
  // Every poster in the book's order, for the poster dialog's arrows.
  const posterOrder = spreads.flatMap((s) => s.posters.map((p) => ({ poster: p, meeting: s.meeting })))
  const club = await buildClub(layout, spreads)
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
  let corkAimed = false
  // The open dialogs: a poster, an album over it (or a record pulled from a crate), or both.
  let poster: { poster: Poster; meeting: Meeting } | null = null
  let pulled: { album: Album; showTracks: boolean } | null = null
  const fest = createLyttefestPanel(() => drawOverlay())
  let entered = false
  const open = () => !!(poster || pulled) || menu.isOpen()
  // Where you stood before opening the book, and the camera's ease to the book or back to it.
  let standing: Pose | null = null
  let ease: { from: Pose; to: Pose; t: number; done: () => void } | null = null
  let closeAfterEase = false // Esc came while the camera was still on its way to the book
  // When the member last left the tab or window, so losing the lock to that keeps the book open.
  let away = -Infinity
  document.addEventListener('visibilitychange', () => { if (document.hidden) away = performance.now() })
  window.addEventListener('blur', () => { away = performance.now() })

  let prompted: string | null = null
  const prompt = (text: string | null) => { if (text !== prompted) showPrompt(prompted = text) }
  let dotted = false
  const reticle = (on: boolean) => { if (on !== dotted) showReticle(dotted = on) }

  const ray = new THREE.Raycaster()
  const centreRay = () => {
    camera.updateMatrixWorld()
    ray.setFromCamera(CENTRE, camera)
    return ray
  }
  /** Within reach of the shut book, the view's centre on it. A book with no posters stays shut. */
  const bookInView = () => spreads.length > 0 && Math.hypot(layout.book.x - camera.position.x, layout.book.z - camera.position.z) <= BOOK_REACH
    && centreRay().intersectObject(book.object).some((h) => shown(h.object))

  /** Within reach of the cork board, with the view's centre on it. */
  const corkInView = () => Math.hypot(club.cork.centre.x - camera.position.x, club.cork.centre.z - camera.position.z) <= BOARD_REACH
    && centreRay().intersectObject(club.cork.object, true).some((h) => shown(h.object))

  openBoard = () => {
    prompt(null)
    controls.unlock()
    menu.open()
  }
  afterBoard = () => prompt(AGAIN)

  // Filled in after the room is up, so a slow Theta never holds the room back.
  const fillCork = () => board.peek().then((posts) => club.cork.setPosts(posts))
  void fillCork()
  setInterval(() => { if (!document.hidden && !menu.isOpen()) void fillCork() }, CORK_EVERY)

  // The screen: a lyttefest while there is one, otherwise the latest meeting, as before.
  const meetingLines = layout.latest ? boardLines(layout.latest, BOARD.cols, BOARD.rows)
    : Array.from({ length: BOARD.rows }, () => ' '.repeat(BOARD.cols))
  async function fillSign() {
    try {
      const res = await fetch('/api/lyttefest', { headers: { accept: 'application/json' } })
      if (!res.ok) return
      const { lyttefest } = await res.json() as { lyttefest: SignFest | null }
      club.screen.setLines(lyttefest ? festLines(lyttefest, BOARD.cols, BOARD.rows) : meetingLines)
    } catch { /* no Theta, no lyttefest: the screen keeps the meeting */ }
  }
  void fillSign()
  setInterval(() => { if (!document.hidden) void fillSign() }, SIGN_EVERY)
  // What a member writes themselves should be on the wall when they turn round.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void fillCork() })

  const pose = (): Pose => ({ position: camera.position.clone(), yaw: camera.rotation.y, pitch: camera.rotation.x })
  const easeTo = (to: Pose, done: () => void) => { ease = { from: pose(), to, t: 0, done } }

  function openBook() {
    if (book.isOpen() || ease || !spreads.length) return
    standing = pose()
    const v = book.viewPose()
    const to = { position: v.position, yaw: towards(standing.yaw, v.yaw), pitch: v.pitch }
    book.open()
    controls.setMovement(false)
    target = null
    bookAimed = false
    closeAfterEase = false
    prompt(BOOK_OPEN)
    easeTo(to, () => {
      controls.setLookRange({ yaw: [to.yaw - LOOK.yaw, to.yaw + LOOK.yaw], pitch: [to.pitch - LOOK.down, to.pitch + LOOK.up] })
      if (closeAfterEase) closeBook()
    })
  }

  /** Back to where you stood; the book shuts once you are there. */
  function closeBook() {
    if (!book.isOpen() || !standing) return
    // Still opening: close once there. (While closing, the ease runs to `standing` itself.)
    if (ease) { if (ease.to !== standing) closeAfterEase = true; return }
    closeAfterEase = false
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
    else if (hit?.kind === 'album') { pulled = { album: hit.album, showTracks: false }; fest.open(hit.album.id) }
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
    // tab or window also releases the mouse and keeps the book open: wait a moment for the blur or
    // the hidden tab, in whatever order they come (a background tab's timer may fire much later).
    if (locked || !book.isOpen() || open()) return
    const lost = performance.now()
    setTimeout(() => {
      if (controls.isLocked() || open() || document.hidden || !document.hasFocus() || away > lost - 100) return
      closeBook()
    }, 100)
  })

  function drawOverlay() {
    if (pulled) {
      const { album, showTracks } = pulled
      return showOverlay(albumDialog({
        album, showTracks, meetingNumber: meetingById.get(album.meetingId)!.number,
        extra: fest.template(album),
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
        onAlbum: (album) => { pulled = { album, showTracks: false }; fest.open(album.id); drawOverlay() },
        onClose: closeAll,
        onPrev: neighbour(-1) ? () => stepPoster(-1) : undefined,
        onNext: neighbour(1) ? () => stepPoster(1) : undefined,
      }))
    }
    showOverlay(null)
  }

  /** The poster before or after the open one, in the book's order. */
  const neighbour = (dir: 1 | -1) => {
    const at = posterOrder.findIndex((p) => p.poster.id === poster?.poster.id)
    return at < 0 ? null : posterOrder[at + dir] ?? null
  }
  function stepPoster(dir: 1 | -1) {
    const next = neighbour(dir)
    if (next) { poster = next; drawOverlay() }
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
    fest.open(album.id)
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
    if (corkAimed) return openBoard()
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
      // The menu has its own Esc; this is for everything else.
      if (menu.isOpen()) return
      else if (open()) closeTop()
      else if (book.isOpen() && !locked) closeBook()
    } else if (poster && !pulled) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') stepPoster(e.code === 'ArrowLeft' ? -1 : 1)
    } else if (book.isOpen()) {
      if (locked && PAGE_KEYS[e.code] && !e.repeat) book.turn(PAGE_KEYS[e.code]) // one page a press
    } else if (e.code === 'KeyE' && locked) {
      if (target) pullOut()
      else if (bookAimed) openBook()
      else if (corkAimed) openBoard()
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
        // The crates come first when both are in view, then the book, then the board on the wall.
        target = crateInView(club.crates, camera)
        bookAimed = !target && bookInView()
        corkAimed = !target && !bookAimed && corkInView()
        prompt(target ? PROMPT : bookAimed ? BOOK_SHUT : corkAimed ? CORK : null)
      }
    } else if (!ease) { target = null; bookAimed = corkAimed = false }
    reticle(controls.isLocked() && book.isOpen() && !ease)
    draw(club.scene, camera)
    requestAnimationFrame(loop)
  })

  // For the screenshot script and the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __club: {
    camera, controls, club, layout, book,
    pullOut: (c: CrateView) => { target = c; pullOut() },
    openPoster: (i: number) => { poster = posterOrder[i]; openDialog() },
    /** What a click on the open book would open now. */
    aim: () => book.aim(centreRay()),
    board, openBoard, fillCork,
  } })
}
