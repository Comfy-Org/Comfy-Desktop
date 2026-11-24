import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import SystemModalApp from './SystemModalApp.vue'
import { createAppI18n } from '../lib/i18nFactory'

document.documentElement.setAttribute('data-theme', 'dark')

loadProprietaryFonts()

createApp(SystemModalApp).use(createAppI18n()).mount('#app')
