import * as THREE from 'three'

// Final pass: the low-res image is stored as sRGB and sampled back as linear; it is encoded
// to sRGB here, then ordered-dithered (4x4 Bayer, one cell per low-res pixel) to 5 bits per
// channel and written straight to the canvas.
const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

const fragmentShader = /* glsl */ `
uniform sampler2D image;
uniform vec2 size;
varying vec2 vUv;
const float bayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  ivec2 px = ivec2(vUv * size);
  vec3 c = linearToSrgb(texelFetch(image, px, 0).rgb);
  float t = (bayer[(px.y % 4) * 4 + px.x % 4] + 0.5) / 16.0;
  gl_FragColor = vec4(min(floor(c * 31.0 + t), 31.0) / 31.0, 1.0);
}`

/** Lines of the low-res render target; the vertex snap grid is half of it. */
export const PS1_HEIGHT = 400

export function createPs1Renderer(canvas: HTMLCanvasElement, opts: { height?: number } = {}) {
  const height = opts.height ?? PS1_HEIGHT
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  const target = new THREE.WebGLRenderTarget(1, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    colorSpace: THREE.SRGBColorSpace,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { image: { value: target.texture }, size: { value: new THREE.Vector2(1, height) } },
    depthTest: false,
    depthWrite: false,
  }))
  quad.frustumCulled = false
  const quadScene = new THREE.Scene()
  quadScene.add(quad)
  const quadCamera = new THREE.Camera()

  function resize() {
    const w = window.innerWidth, h = window.innerHeight
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    const width = Math.max(1, Math.round(height * w / h))
    target.setSize(width, height)
    quad.material.uniforms.size.value.set(width, height)
  }
  resize()
  window.addEventListener('resize', resize)

  return {
    renderer,
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
      const aspect = target.width / target.height
      if (camera.aspect !== aspect) {
        camera.aspect = aspect
        camera.updateProjectionMatrix()
      }
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      renderer.render(quadScene, quadCamera)
    },
    dispose() {
      window.removeEventListener('resize', resize)
      target.dispose()
      quad.geometry.dispose()
      quad.material.dispose()
      renderer.dispose()
    },
  }
}
