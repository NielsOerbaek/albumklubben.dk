import { html, nothing, type TemplateResult } from 'lit-html'
import { faceTemplate } from './face.ts'
import { currentMe } from './me.ts'

const LINKS = [['klubhus', 'Klubhuset', '/klubhuset']] as const

/** Who you are logged in as, beside the way out. It is not there until `loadMe` has answered,
 * and the whole site is behind the login, so there is no logged-out state for it to have. */
const meTemplate = () => {
  const me = currentMe()
  return me === null ? nothing
    : html`<span class="topbar-me" title=${me.name}>${faceTemplate(me, 22)}
        <span class="topbar-name">${me.name}</span></span>`
}

/** The club's group on Theta, which is where things are written and answered. */
const groupTemplate = () => {
  const url = currentMe()?.groupUrl
  return url ? html`<a class="pill" href=${url} target="_blank" rel="noreferrer">Thetagruppe</a>` : nothing
}

/**
 * The shared thin black top bar: the wordmark (the front page) and Klubhuset. `right` holds pills
 * (toggles), then who you are, the club's group on Theta and the way out.
 *
 * Opslagstavlen is not here any more. It is the cork board on the wall in Klubhuset, opened by
 * walking up to it and clicking — a thing in the room rather than a dialog over every page.
 */
export function topBarTemplate(
  active: 'klubhus' | null,
  right?: TemplateResult,
): TemplateResult {
  return html`<header class="topbar">
    <a class="wordmark" href="/">Albumklubben</a>
    <nav>
      ${LINKS.map(([id, text, href]) =>
        html`<a href=${href} aria-current=${active === id ? 'page' : nothing}>${text}</a>`)}
    </nav>
    <div class="topbar-right">${right ?? nothing}${meTemplate()}${groupTemplate()}<a
      class="pill" href="/auth/logout">Log ud</a></div>
  </header>`
}
