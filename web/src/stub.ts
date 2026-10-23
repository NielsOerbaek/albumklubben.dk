import { html, render } from 'lit-html'
import './base.css'
import { topBarTemplate } from './topbar.ts'

/** A placeholder page: the top bar and a heading. */
export function stubPage(active: 'crate' | 'museum', heading: string) {
  render(html`${topBarTemplate(active)}
    <main class="stub"><h1>${heading}</h1><p><a href="/">Tilbage til forsiden</a></p></main>`,
    document.getElementById('app')!)
}
