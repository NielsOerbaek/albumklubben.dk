import { html, nothing, type TemplateResult } from 'lit-html'

const LINKS = [['klubhus', 'Klubhuset', '/klubhuset']] as const

/** The shared thin black top bar: the wordmark (the front page), Klubhuset and the opslagstavle,
 * which opens over whatever page you are on. `right` holds pills (toggles), then the way out. */
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
    <div class="topbar-right">${right ?? nothing}<a class="pill" href="/auth/logout">Log ud</a></div>
  </header>`
}
