import { createPinia } from 'pinia'
import { setup, type Preview } from '@storybook/vue3-vite'
import { createAppI18n } from '../src/renderer/src/lib/i18nFactory'
import '../src/renderer/src/assets/main.css'

setup((app) => {
  app.use(createPinia())
  // Not the panel's shared instance: vue-i18n disposes an installed instance when its app unmounts.
  app.use(createAppI18n())
})

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    // Takeover screens teleport to body. On the generated Docs page, separate
    // iframes run each example's play function and isolate its Electron API
    // fixture and stores; `docs.story.autoplay` applies only to inline stories.
    docs: { story: { inline: false, height: '800px' } }
  },
  beforeEach() {
    document.documentElement.dataset.theme = 'dark'
  }
}

export default preview
