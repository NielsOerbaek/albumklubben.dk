import * as THREE from 'three'
import { moveWithCollision, type Box2 } from './collide.ts'

const SENSITIVITY = 0.002 // radians per pixel of mouse movement
const MAX_PITCH = THREE.MathUtils.degToRad(80)
const KEYS: Record<string, [number, number]> = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] }

/** First-person walking: click for pointer lock, WASD, mouse look, Shift for double speed,
 *  Esc releases (the browser does that). No head bob. Callers that open an overlay call
 *  `unlock()`, and `lock()` from a click or key handler to walk on (browsers need a gesture).
 *  `setMovement(false)` freezes walking, `setLookRange` clamps the look, `setPose` moves the camera. */
export function createWalkControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  opts: { boxes: Box2[]; radius?: number; speed?: number; eyeHeight?: number },
) {
  const radius = opts.radius ?? 0.3
  const speed = opts.speed ?? 2.2
  let boxes = opts.boxes
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  let yaw = euler.y
  let pitch = THREE.MathUtils.clamp(euler.x, -MAX_PITCH, MAX_PITCH)
  camera.rotation.order = 'YXZ'
  camera.position.y = opts.eyeHeight ?? 1.6
  const down = new Set<string>()
  let moving = true
  let range: { yaw: [number, number]; pitch: [number, number] } | null = null
  const clampLook = () => {
    pitch = THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH)
    if (!range) return
    yaw = THREE.MathUtils.clamp(yaw, ...range.yaw)
    pitch = THREE.MathUtils.clamp(pitch, ...range.pitch)
  }
  const listeners: ((locked: boolean) => void)[] = []

  const isLocked = () => document.pointerLockElement === dom
  const lock = () => {
    // Rejects e.g. right after the user pressed Esc; they simply click again.
    if (!isLocked()) Promise.resolve(dom.requestPointerLock()).catch(() => {})
  }
  const unlock = () => { if (isLocked()) document.exitPointerLock() }

  const onMouseMove = (e: MouseEvent) => {
    if (!isLocked()) return
    // Chromium sometimes reports a huge jump right after locking; skip it.
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return
    yaw -= e.movementX * SENSITIVITY
    pitch -= e.movementY * SENSITIVITY
    clampLook()
  }
  const onKeyDown = (e: KeyboardEvent) => { if (isLocked()) down.add(e.code) }
  const onKeyUp = (e: KeyboardEvent) => down.delete(e.code)
  const onLockChange = () => {
    if (!isLocked()) down.clear()
    for (const cb of listeners) cb(isLocked())
  }
  const onBlur = () => down.clear()

  dom.addEventListener('click', lock)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('pointerlockchange', onLockChange)
  window.addEventListener('blur', onBlur)

  return {
    update(dt: number) {
      camera.rotation.set(pitch, yaw, 0)
      if (!moving) return
      let side = 0, fwd = 0
      for (const code of down) {
        const k = KEYS[code]
        if (k) { side += k[0]; fwd += k[1] }
      }
      const len = Math.hypot(side, fwd)
      if (!len) return
      const fast = down.has('ShiftLeft') || down.has('ShiftRight') ? 2 : 1
      const step = speed * fast * Math.min(dt, 0.1) / len
      const sin = Math.sin(yaw), cos = Math.cos(yaw)
      // Forward is -Z rotated by yaw; right is +X rotated by yaw.
      const dx = (side * cos - fwd * sin) * step
      const dz = (-side * sin - fwd * cos) * step
      const [x, z] = moveWithCollision([camera.position.x, camera.position.z], [dx, dz], radius, boxes)
      camera.position.x = x
      camera.position.z = z
    },
    isLocked,
    lock,
    unlock,
    onLockChange(cb: (locked: boolean) => void) { listeners.push(cb) },
    setBoxes(b: Box2[]) { boxes = b },
    /** While off, WASD is ignored; the mouse still looks. */
    setMovement(enabled: boolean) { moving = enabled; down.clear() },
    /** Clamps yaw and pitch (radians) while set; `null` frees them. */
    setLookRange(r: { yaw: [number, number]; pitch: [number, number] } | null) { range = r; clampLook() },
    /** Puts the camera at `position`, looking along `yaw` and `pitch`. */
    setPose(position: THREE.Vector3, y: number, p: number) {
      camera.position.copy(position)
      yaw = y
      pitch = THREE.MathUtils.clamp(p, -MAX_PITCH, MAX_PITCH)
      camera.rotation.set(pitch, yaw, 0)
    },
    dispose() {
      unlock()
      dom.removeEventListener('click', lock)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('pointerlockchange', onLockChange)
      window.removeEventListener('blur', onBlur)
    },
  }
}
