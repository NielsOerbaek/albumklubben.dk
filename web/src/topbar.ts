import { html, nothing, type TemplateResult } from 'lit-html'

const LINKS = [['crate', 'Crate digging', '/crate'], ['museum', 'Museum', '/museum'], ['arkiv', 'Arkivet', '/arkiv']] as const

/** The shared thin black top bar. `right` holds pills (toggles). */
export function topBarTemplate(
  active: 'crate' | 'museum' | 'arkiv' | null,
  right?: TemplateResult,
): TemplateResult {
  return html`<header class="topbar">
    <a class="wordmark" href="/">Albumklubben</a>
    <nav>
      ${LINKS.map(([id, text, href]) =>
        html`<a href=${href} aria-current=${active === id ? 'page' : nothing}>${text}</a>`)}
    </nav>
    ${right ? html`<div class="topbar-right">${right}</div>` : nothing}
  </header>`
}
