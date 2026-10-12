import { createPinia } from 'pinia'
import { setup, type Preview } from '@storybook/vue3-vite'
import { createAppI18n } from '../src/renderer/src/lib/i18nFactory'
import '../src/renderer/src/assets/main.css'

setup((app) => {
  app.use(createPinia())
  app.use(createAppI18n())
})

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    // Takeover screens teleport to body. Separate iframes also isolate each
    // example's Electron API fixture and stores on the generated Docs page.
    docs: { story: { inline: false, height: '800px' } }
  },
  beforeEach() {
    document.documentElement.dataset.theme = 'dark'
  }
}

export default preview
