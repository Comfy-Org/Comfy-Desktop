import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import TitlePopupApp from './TitlePopupApp.vue'
import { createAppI18n } from '../lib/i18nFactory'
import { installPickerSettingsApiShim } from './pickerSettingsApiShim'
import { PALETTE_VOID_CLASS } from '../composables/usePaletteScope'

// Default to dark; the popup overrides bg/text inline from main's theme,
// but data-theme still drives any non-overridden fallback CSS variables.
// Telemetry is captured main-side, not here, to avoid minting a new
// session on every transient popup open.
document.documentElement.setAttribute('data-theme', 'dark')
// Everything this renderer draws is in the Void palette (assets/palette-void.css).
document.documentElement.classList.add(PALETTE_VOID_CLASS)

// Must run BEFORE Vue mounts so modules that capture window.api at import
// time (e.g. useComfyUISettings) see the shim populated.
installPickerSettingsApiShim()

const pinia = createPinia()

loadProprietaryFonts()

createApp(TitlePopupApp).use(pinia).use(createAppI18n()).mount('#app')
