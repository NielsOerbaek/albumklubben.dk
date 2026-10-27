#!/usr/bin/env node
/**
 * Albumklubbens ikon: en vinylplade set forfra, tegnet på et 16×16 pixelgitter i Klubhusets
 * PS1-stil — hårde kanter, fire farver. Herfra laves SVG-masteren og alle rasterstørrelser,
 * så ikonet kan tegnes om ved at rette tallene nedenfor:
 *
 *     node tools/make-icons.mjs
 *
 * Pladen har en lysegrå yderkant, så silhuetten også kan ses på en sort fanebjælke, og en
 * lyserød midterlabel (#fe3ebe, en af albumkortenes farver), som kan ses på både sort og hvid.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const N = 16 // pixelgitteret
const PUBLIC = resolve(import.meta.dirname, '..', 'web', 'public')
const VINYL = '#121212'
const RIM = '#7a7a7a'
const GROOVE = '#3a3a3a'
const LABEL = '#fe3ebe'

/** Pixels hvis midte ligger i ringen [r0, r1), som vandrette striber: [x, bredde]. */
function ring(r0, r1) {
  const out = []
  for (let y = 0; y < N; y++) {
    const dy = y + 0.5 - N / 2
    let run = null
    for (let x = 0; x < N; x++) {
      const inside = (() => {
        const d = Math.hypot(x + 0.5 - N / 2, dy)
        return d >= r0 && d < r1
      })()
      if (inside && run === null) run = x
      else if (!inside && run !== null) { out.push([run, y, x - run]); run = null }
    }
    if (run !== null) out.push([run, y, N - run])
  }
  return out
}

// Nedefra og op: pladen, kanten, en rille, labelen og hullet i midten.
const LAYERS = [
  [VINYL, ring(0, 8)],
  [RIM, ring(7, 8)],
  [GROOVE, ring(5, 6)],
  [LABEL, ring(0, 3)],
  [VINYL, ring(0, 1)],
]

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${N}" height="${N}" shape-rendering="crispEdges">
<title>Albumklubben</title>
${LAYERS.map(([fill, px]) => `<g fill="${fill}">${px.map(([x, y, w]) =>
  `<rect x="${x}" y="${y}" width="${w}" height="1"/>`).join('')}</g>`).join('\n')}
</svg>
`
writeFileSync(resolve(PUBLIC, 'icon.svg'), svg)

// Rasteriseres én gang på gitteret og skaleres derefter med nærmeste nabo, så pixelkanterne
// bliver hårde i alle størrelser.
const base = await sharp(Buffer.from(svg)).resize(N, N, { kernel: 'nearest' }).png().toBuffer()
const scale = (size, background) => {
  let img = sharp(base).resize(size, size, { kernel: 'nearest' })
  if (background) img = img.flatten({ background })
  return img.png({ compressionLevel: 9 }).toBuffer()
}

const write = (name, buf) => { writeFileSync(resolve(PUBLIC, name), buf); return buf }

// Apple lægger selv ikonet på en afrundet flade, så det skal have en bund.
write('apple-touch-icon.png', await scale(180, '#000'))
write('icon-192.png', await scale(192))
write('icon-512.png', await scale(512))

// Maskable: pladen inde i den sikre zone (80 %) på sort, så Android kan klippe den til.
const inner = await scale(16 * 26) // 416 px af 512
write('icon-maskable-512.png', await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#000' },
}).composite([{ input: inner, left: 48, top: 48 }]).png({ compressionLevel: 9 }).toBuffer())

/** ICO med PNG-billeder indeni: en header, en post pr. størrelse og så billederne. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i
    head.writeUInt8(size, at); head.writeUInt8(size, at + 1)
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(data.length, at + 8); head.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map(i => i.data)])
}
write('favicon.ico', ico([
  { size: 16, data: await scale(16) },
  { size: 32, data: await scale(32) },
]))

writeFileSync(resolve(PUBLIC, 'manifest.webmanifest'), JSON.stringify({
  name: 'Albumklubben',
  short_name: 'Albumklubben',
  start_url: '/',
  display: 'standalone',
  background_color: '#000000',
  theme_color: '#000000',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n')

console.log('Ikoner skrevet til web/public/')
