import '../assets/main.css'
import '../assets/chrome-void.css'
import { followChromeDesign } from '../design/landing/chromeTheme'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import TitleTooltipApp from './TitleTooltipApp.vue'

// Default to dark; the popup overrides bg/text/border inline from main's
// theme, but data-theme still drives non-overridden fallback CSS vars.
// Renderer telemetry bootstrap is intentionally skipped: this transient
// hover surface would mint a new session per hover for zero value.
document.documentElement.setAttribute('data-theme', 'dark')
// The new design system's skin for the window chrome, from Milestone 1 of
// the design prototype (assets/chrome-void.css).
followChromeDesign()

loadProprietaryFonts()

createApp(TitleTooltipApp).mount('#app')
