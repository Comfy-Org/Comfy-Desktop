import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import SystemModalApp from './SystemModalApp.vue'

document.documentElement.setAttribute('data-theme', 'dark')

loadProprietaryFonts()

createApp(SystemModalApp).mount('#app')
