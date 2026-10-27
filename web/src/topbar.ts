import { html, nothing, type TemplateResult } from 'lit-html'

const LINKS = [['klubhus', 'Klubhuset', '/klubhuset']] as const

/** The shared thin black top bar: the wordmark (the front page) and Klubhuset. `right` holds pills
 * (toggles), and after them the way out. */
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
    <div class="topbar-right">${right ?? nothing}<a class="pill" href="/auth/logout">Log ud</a></div>
  </header>`
}
