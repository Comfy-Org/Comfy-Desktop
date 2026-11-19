import { TITLEBAR_STATE_KEY } from './titleBarBridge'
import './look'

/**
 * The app chrome (title bar, its popups and tooltips - separate renderers)
 * takes the new design system from Milestone 1 (assets/chrome-void.css);
 * Milestone 0 keeps today's. It follows the milestone the launcher page
 * publishes (titleBar.ts), live.
 */
function publishedMilestone(): number {
  try {
    return JSON.parse(localStorage.getItem(TITLEBAR_STATE_KEY) ?? 'null')?.milestone ?? 0
  } catch {
    return 0
  }
}

export function followChromeDesign(): void {
  const apply = (): void => {
    document.documentElement.classList.toggle('chrome-void', publishedMilestone() >= 1)
  }
  apply()
  window.addEventListener('storage', (e) => {
    if (e.key === TITLEBAR_STATE_KEY) apply()
  })
}
