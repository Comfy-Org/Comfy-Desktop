import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import TitleBarApp from './TitleBarApp.vue'
import { initializeRendererBootstrap } from '../lib/rendererBootstrap'
import { createAppI18n } from '../lib/i18nFactory'

initializeRendererBootstrap('title-bar')

document.documentElement.setAttribute('data-theme', 'dark')

loadProprietaryFonts()

createApp(TitleBarApp).use(createAppI18n()).mount('#app')
