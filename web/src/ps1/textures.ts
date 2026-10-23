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

/** A video as a hard-pixel texture. The caller plays and pauses the video. */
export function videoTexture(video: HTMLVideoElement): THREE.VideoTexture {
  return pixelate(new THREE.VideoTexture(video))
}
