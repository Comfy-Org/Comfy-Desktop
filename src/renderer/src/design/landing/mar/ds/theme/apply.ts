/**
 * The Theme playground's tokens reach its specimen frames, and the frames
 * nested in them (stages), through this key: the page writes each
 * theme's CSS, every frame with `?pg` applies its own and follows changes
 * (a `storage` event reaches every other document of the site).
 */
export const CSS_KEY = 'mar-ds.theme-playground.css'

export function applyPlaygroundCss(theme: 'dark' | 'light'): void {
  const el = document.createElement('style')
  el.id = 'pg-tokens'
  document.head.append(el)
  const set = (): void => {
    try {
      el.textContent = JSON.parse(localStorage.getItem(CSS_KEY) ?? '{}')[theme] ?? ''
    } catch {
      el.textContent = ''
    }
  }
  set()
  window.addEventListener('storage', (e) => {
    if (e.key === CSS_KEY) set()
  })
}
