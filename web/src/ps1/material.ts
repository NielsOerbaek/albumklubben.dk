import * as THREE from 'three'
import { PS1_HEIGHT } from './renderer.ts'

// Colour: textures are sRGB, so the GPU decodes them to linear when sampled (three uploads
// video frames as plain RGBA8, hence the shader decode for those). Everything here is linear;
// the low-res target stores sRGB and the final pass in renderer.ts dithers in sRGB.

const vertexShader = /* glsl */ `
uniform float snap;
varying vec3 vUvw;      // uv * w and w: dividing in the fragment shader undoes perspective
varying float vDepth;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * view;
  if (clip.w > 0.0) clip.xy = floor(clip.xy / clip.w * snap + 0.5) / snap * clip.w;
  gl_Position = clip;
  vUvw = vec3(uv * clip.w, clip.w);
  vDepth = length(view.xyz);
}`

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform bool decodeMap;
uniform vec3 color;
uniform float ambient;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec3 vUvw;
varying float vDepth;
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  vec4 texel = texture2D(map, vUvw.xy / vUvw.z);
  if (texel.a < 0.5) discard;
  if (decodeMap) texel.rgb = srgbToLinear(texel.rgb);
  vec3 rgb = texel.rgb * color * ambient;
  float fog = clamp((vDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(rgb, fogColor, fog), 1.0);
}`

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
white.needsUpdate = true

/** PS1 surface: wobbling (snapped) vertices, affine UVs, linear fog, flat ambient light.
 *  `uniforms.map.value` can be swapped later, e.g. when a cover or video has loaded. */
export function ps1Material(opts: {
  map?: THREE.Texture | null
  color?: THREE.ColorRepresentation
  fogColor: THREE.ColorRepresentation
  fogNear: number
  fogFar: number
  snap?: number
}): THREE.ShaderMaterial {
  const map = { value: opts.map ?? white }
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      map,
      decodeMap: { get value() { return (map.value as THREE.VideoTexture).isVideoTexture === true } },
      color: { value: new THREE.Color(opts.color ?? 0xffffff) },
      ambient: { value: 1 },
      fogColor: { value: new THREE.Color(opts.fogColor) },
      fogNear: { value: opts.fogNear },
      fogFar: { value: opts.fogFar },
      snap: { value: opts.snap ?? PS1_HEIGHT / 2 },
    },
  })
}
