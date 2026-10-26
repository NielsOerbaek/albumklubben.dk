import * as THREE from 'three'
import { render } from 'lit-html'
import '../base.css'
import './museum.css'
import { fetchArchive, textureUrl } from '../api.ts'
import { albumDialog } from '../album.ts'
import { topBarTemplate } from '../topbar.ts'
import { createPs1Renderer } from '../ps1/renderer.ts'
import { createWalkControls } from '../ps1/controls.ts'
import { FIRST_HINT, showHint, showOverlay, showPrompt, smallScreenGuard } from '../ps1/hud.ts'
import { loadPixelTexture } from '../ps1/textures.ts'
import type { Album } from '../../../shared/types.ts'
import { buildMuseumLayout } from './layout.ts'
import { buildMuseum, type CoverView } from './scene.ts'
import { createVideoWall, nearestInView, type Player } from './video.ts'

const REACH = 2 // metres, to read a plaque or take a cover down
const PLAQUE_ANGLE = 30
const COVER_PROMPT = 'Klik for at se pladen'
const AGAIN = 'Klik for at gå videre'

render(topBarTemplate('museum'), document.getElementById('app')!)
const canvas = document.querySelector<HTMLCanvasElement>('canvas.ps1-canvas')!
if (smallScreenGuard()) canvas.remove()
else start().catch((e) => {
  console.error(e)
  showHint('Museet kunne ikke åbne. Prøv at genindlæse siden.')
})

async function start() {
  showHint('Henter plakaterne')
  const archive = await fetchArchive()
  const posters = archive.meetings.flatMap((m) => m.posters)
  const images = new Map(await Promise.all(posters.map(async (p) =>
    [p.id, await loadPixelTexture(textureUrl(p.imageUrl, 256)).catch(() => null)] as const)))
  const aspects = new Map<number, number>()
  for (const [id, tex] of images) {
    const img = tex?.image as { width: number; height: number } | undefined
    if (img?.width && img.height) aspects.set(id, img.width / img.height)
  }
  const layout = buildMuseumLayout(archive.meetings, aspects)
  const museum = await buildMuseum(layout, images)
  const meetingNumber = new Map(archive.meetings.map((m) => [m.id, m.number]))

  const { render: draw } = createPs1Renderer(canvas)
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40)
  camera.position.set(layout.spawn.x, 0, layout.spawn.z)
  camera.rotation.set(0.04, layout.spawn.yaw, 0, 'YXZ')
  const controls = createWalkControls(camera, canvas, { boxes: layout.boxes })
  const videos = createVideoWall(museum.videoPosters)
  const player = (): Player => ({ x: camera.position.x, z: camera.position.z, yaw: camera.rotation.y })

  let open: { album: Album; showTracks: boolean } | null = null
  let aimed: CoverView | null = null
  let entered = false
  let prompt: string | null = null
  const setPrompt = (text: string | null) => { if (text !== prompt) showPrompt(prompt = text) }

  controls.onLockChange((locked) => {
    document.body.classList.toggle('walking', locked)
    entered ||= locked
    if (!locked) {
      videos.update(null)
      aimed = null
    }
    setPrompt(locked || open || !entered ? null : AGAIN)
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) videos.update(null) })

  function drawOverlay() {
    if (!open) return showOverlay(null)
    const { album, showTracks } = open
    showOverlay(albumDialog({
      album, showTracks, meetingNumber: meetingNumber.get(album.meetingId)!,
      help: 'Esc for at lægge den tilbage',
      onToggle: () => { open!.showTracks = !open!.showTracks; drawOverlay() },
      onClose: close,
    }))
  }

  function openCover(cover: CoverView) {
    open = { album: cover.item.album!, showTracks: false }
    controls.unlock()
    setPrompt(null)
    drawOverlay()
  }

  function close() {
    open = null
    drawOverlay()
    setPrompt(AGAIN)
  }

  canvas.addEventListener('click', () => { if (controls.isLocked() && aimed) openCover(aimed) })
  document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && open) close() })

  // The cover under the centre of the view, if it is in reach.
  const ray = new THREE.Raycaster()
  ray.far = REACH
  const centre = new THREE.Vector2()
  const coverMeshes = museum.covers.map((c) => c.mesh)
  const coverOf = new Map(museum.covers.map((c) => [c.mesh as THREE.Object3D, c]))

  showHint(FIRST_HINT)
  let last = performance.now()
  requestAnimationFrame(function loop(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1)
    last = now
    controls.update(dt)
    if (controls.isLocked() && !document.hidden) {
      const p = player()
      videos.update(p)
      ray.setFromCamera(centre, camera)
      const hit = ray.intersectObjects(coverMeshes, false)[0]
      aimed = hit ? coverOf.get(hit.object) ?? null : null
      const plaque = aimed ? null : nearestInView(p, layout.plaques, REACH, PLAQUE_ANGLE)
      setPrompt(aimed ? COVER_PROMPT : plaque ? plaque.lines.join(' · ') : null)
    }
    draw(museum.scene, camera)
    requestAnimationFrame(loop)
  })

  if (import.meta.env.DEV) Object.assign(window, { __museum: { camera, controls, layout, museum, openCover } })
}
