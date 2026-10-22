import '../assets/main.css'
import '../assets/chrome-void.css'
import { followChromeDesign } from '../design/landing/chromeTheme'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import TitlePopupApp from './TitlePopupApp.vue'
import { createAppI18n } from '../lib/i18nFactory'
import { installPickerSettingsApiShim } from './pickerSettingsApiShim'

// Default to dark; the popup overrides bg/text inline from main's theme,
// but data-theme still drives any non-overridden fallback CSS variables.
// Telemetry is captured main-side, not here, to avoid minting a new
// session on every transient popup open.
document.documentElement.setAttribute('data-theme', 'dark')
// The new design system's skin for the window chrome, from Milestone 1 of
// the design prototype (assets/chrome-void.css).
followChromeDesign()

// Must run BEFORE Vue mounts so modules that capture window.api at import
// time (e.g. useComfyUISettings) see the shim populated.
installPickerSettingsApiShim()

const pinia = createPinia()

loadProprietaryFonts()

createApp(TitlePopupApp).use(pinia).use(createAppI18n()).mount('#app')
