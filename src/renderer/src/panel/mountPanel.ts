import '../assets/main.css'
import { loadProprietaryFonts } from '../assets/proprietaryFonts'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PanelApp from './PanelApp.vue'
import { i18n } from '../i18n'

export function mountPanel(): void {
  document.documentElement.classList.add('desktop-panel')

  loadProprietaryFonts()

  const app = createApp(PanelApp)
  app.use(createPinia())
  app.use(i18n)
  app.mount('#app')

  document.getElementById('panel-boot-splash')?.remove()
}
