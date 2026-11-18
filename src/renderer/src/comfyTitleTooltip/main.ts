import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import TitleTooltipApp from './TitleTooltipApp.vue'

document.documentElement.setAttribute('data-theme', 'dark')

loadProprietaryFonts()

createApp(TitleTooltipApp).mount('#app')
