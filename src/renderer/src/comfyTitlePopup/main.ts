import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import TitlePopupApp from './TitlePopupApp.vue'
import { createAppI18n } from '../lib/i18nFactory'
import { installPickerSettingsApiShim } from './pickerSettingsApiShim'

// Desktop popups always use the fixed palette; only the title bar follows
// the embedded ComfyUI theme.
// Telemetry is captured main-side, not here, to avoid minting a new
// session on every transient popup open.
document.documentElement.setAttribute('data-theme', 'dark')
// Everything this renderer draws is in the Void palette (assets/palette-void.css).
document.documentElement.classList.add('palette-void')

// Must run BEFORE Vue mounts so modules that capture window.api at import
// time (e.g. useComfyUISettings) see the shim populated.
installPickerSettingsApiShim()

const pinia = createPinia()

loadProprietaryFonts()

createApp(TitlePopupApp).use(pinia).use(createAppI18n()).mount('#app')
