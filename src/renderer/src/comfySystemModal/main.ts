import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createSystemModalApp } from './createSystemModalApp'

document.documentElement.setAttribute('data-theme', 'dark')

loadProprietaryFonts()

createSystemModalApp().mount('#app')
