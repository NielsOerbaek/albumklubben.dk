import * as THREE from 'three'

/** Hard-pixel settings: nearest filtering, no mipmaps, sRGB. */
export function pixelate<T extends THREE.Texture>(tex: T): T {
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Loads an image as a hard-pixel texture: nearest filtering, no mipmaps, sRGB. */
export async function loadPixelTexture(url: string): Promise<THREE.Texture> {
  return pixelate(await new THREE.TextureLoader().loadAsync(url))
}
