// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createWalkControls } from '../../web/src/ps1/controls.ts'

// Pointer lock is faked: the controls only read `document.pointerLockElement`.
let lockedTo: Element | null = null
Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => lockedTo })

let controls: ReturnType<typeof createWalkControls> | null = null
function setup() {
  const dom = document.createElement('canvas')
  document.body.append(dom)
  const camera = new THREE.PerspectiveCamera()
  controls = createWalkControls(camera, dom, { boxes: [] })
  lockedTo = dom
  return { camera, controls }
}
afterEach(() => { lockedTo = null; controls?.dispose(); controls = null })

const key = (type: 'keydown' | 'keyup', code: string) => document.dispatchEvent(new KeyboardEvent(type, { code }))
const look = (x: number, y: number) => {
  const e = new MouseEvent('mousemove')
  Object.defineProperties(e, { movementX: { value: x }, movementY: { value: y } })
  document.dispatchEvent(e)
}

describe('walk controls', () => {
  it('ignores WASD while movement is off and keeps looking', () => {
    const { camera, controls } = setup()
    controls.setMovement(false)
    key('keydown', 'KeyW')
    key('keydown', 'KeyD')
    look(100, 0)
    controls.update(0.1)
    expect(camera.position.x).toBe(0)
    expect(camera.position.z).toBe(0)
    expect(camera.rotation.y).toBeCloseTo(-0.2)
    key('keyup', 'KeyW')
    key('keyup', 'KeyD')

    controls.setMovement(true)
    key('keydown', 'KeyW')
    controls.update(0.1)
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeGreaterThan(0.1)
  })

  it('clamps yaw and pitch to the look range, and frees them when the range is null', () => {
    const { camera, controls } = setup()
    controls.setPose(new THREE.Vector3(1, 1.2, 2), 0.3, 0)
    expect(camera.position.toArray()).toEqual([1, 1.2, 2])
    expect(camera.rotation.y).toBeCloseTo(0.3)

    controls.setLookRange({ yaw: [0, 0.6], pitch: [-1, -0.2] })
    controls.update(0)
    expect(camera.rotation.x).toBeCloseTo(-0.2) // pulled into the range at once
    for (let i = 0; i < 4; i++) look(250, 250) // right and down, far past the range
    controls.update(0)
    expect(camera.rotation.y).toBeCloseTo(0)
    expect(camera.rotation.x).toBeCloseTo(-1)
    for (let i = 0; i < 4; i++) look(-250, -250)
    controls.update(0)
    expect(camera.rotation.y).toBeCloseTo(0.6)
    expect(camera.rotation.x).toBeCloseTo(-0.2)

    controls.setLookRange(null)
    for (let i = 0; i < 4; i++) look(-250, -100)
    controls.update(0)
    expect(camera.rotation.y).toBeCloseTo(2.6)
    expect(camera.rotation.x).toBeCloseTo(0.6)
  })
})
