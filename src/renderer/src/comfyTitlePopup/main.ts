import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import TitlePopupApp from './TitlePopupApp.vue'
import { createAppI18n } from '../lib/i18nFactory'
import { installPickerSettingsApiShim } from './pickerSettingsApiShim'

document.documentElement.setAttribute('data-theme', 'dark')

installPickerSettingsApiShim()

const pinia = createPinia()

loadProprietaryFonts()

createApp(TitlePopupApp).use(pinia).use(createAppI18n()).mount('#app')
