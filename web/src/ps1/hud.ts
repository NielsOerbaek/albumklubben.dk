import { html, render, type TemplateResult } from 'lit-html'
import './hud.css'

export const FIRST_HINT = 'Klik for at gå ind · WASD for at gå · mus for at se dig om · Esc for at slippe'

let root: HTMLElement | null = null
const layer = (name: 'hint' | 'prompt' | 'overlay') => {
  if (!root) {
    root = document.createElement('div')
    root.className = 'ps1-hud'
    render(html`<div class="ps1-hint" hidden></div><div class="ps1-prompt" hidden></div>
      <div class="ps1-overlay" hidden></div>`, root)
    document.body.append(root)
  }
  return root.querySelector<HTMLElement>(`.ps1-${name}`)!
}

const setText = (el: HTMLElement, text: string | null) => {
  el.textContent = text ?? ''
  el.hidden = !text
}

/** A centred hint that hides itself once the pointer is locked (call again to show it again). */
export function showHint(text: string) {
  const el = layer('hint')
  setText(el, text)
  const hide = () => {
    if (!document.pointerLockElement) return
    el.hidden = true
    document.removeEventListener('pointerlockchange', hide)
  }
  document.addEventListener('pointerlockchange', hide)
}

/** A short prompt near the bottom, e.g. what pressing a key does here. `null` hides it. */
export function showPrompt(text: string | null) {
  setText(layer('prompt'), text)
}

/** Crisp DOM content (e.g. the album card) above the canvas. `null` removes it. */
export function showOverlay(content: TemplateResult | null) {
  const el = layer('overlay')
  render(content, el)
  el.hidden = !content
}

/** Below 900 px the rooms are not shown: renders the message and returns `true`. */
export function smallScreenGuard(): boolean {
  if (window.innerWidth >= 900) return false
  const el = document.createElement('main')
  el.className = 'ps1-small'
  render(html`<p>Rummene er lavet til en computer. Prøv <a href="/arkiv">Arkivet</a>.</p>`, el)
  document.body.append(el)
  return true
}
