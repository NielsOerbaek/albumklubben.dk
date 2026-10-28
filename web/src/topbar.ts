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

/** The shared thin black top bar: the wordmark (the front page), Klubhuset and the opslagstavle,
 * which opens over whatever page you are on. `right` holds pills (toggles), then who you are and
 * the way out. */
export function topBarTemplate(
  active: 'klubhus' | null,
  right?: TemplateResult,
  onBoard?: () => void,
): TemplateResult {
  return html`<header class="topbar">
    <a class="wordmark" href="/">Albumklubben</a>
    <nav>
      ${LINKS.map(([id, text, href]) =>
        html`<a href=${href} aria-current=${active === id ? 'page' : nothing}>${text}</a>`)}
      ${onBoard ? html`<button class="topbar-link" @click=${onBoard}>Opslagstavlen</button>` : nothing}
    </nav>
    <div class="topbar-right">${right ?? nothing}${meTemplate()}<a class="pill" href="/auth/logout">Log ud</a></div>
  </header>`
}
