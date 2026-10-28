import { html, nothing, type TemplateResult } from 'lit-html'

/**
 * A member's face: the avatar Theta has for them, or their initials when it has none and when
 * the picture will not load. The initials are not a placeholder waiting for the real thing —
 * for a member who has not logged in since the site started keeping avatars, they are it.
 *
 * The image is fetched straight from Theta without a referrer, so the club's own pages are not
 * announced to it; if that fetch fails for any reason, the initials are already underneath.
 */
export interface Face { sub: string; name: string; picture: string | null }

/** "Niels Ørbæk Chemnitz" → "NC". One letter when there is only one word to take it from. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = [...words[0]][0] ?? ''
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : ''
  return (first + last).toUpperCase()
}

/** A colour of their own, so members without a picture are still told apart at a glance. */
function hue(sub: string): number {
  let h = 0
  for (const ch of sub) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}

export function faceTemplate(who: Face, size = 24): TemplateResult {
  return html`<span class="face" style=${`--face-size:${size}px;--face-hue:${hue(who.sub)}`}>
    <span class="face-initials" aria-hidden="true">${initials(who.name)}</span>
    ${who.picture
      ? html`<img class="face-img" src=${who.picture} alt="" loading="lazy" decoding="async"
          referrerpolicy="no-referrer"
          @error=${(e: Event) => { (e.target as HTMLImageElement).style.display = 'none' }}>`
      : nothing}
  </span>`
}
