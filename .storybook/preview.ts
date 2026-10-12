import { createPinia } from 'pinia'
import type { App } from 'vue'
import { setup, type Preview } from '@storybook/vue3-vite'
import { createAppI18n } from '../src/renderer/src/lib/i18nFactory'
import '../src/renderer/src/assets/main.css'

function installPlugins(app: App): void {
  app.use(createPinia())
  // Not the panel's shared instance: vue-i18n disposes an installed instance when its app unmounts.
  app.use(createAppI18n())
}

setup(installPlugins)
// Storybook keeps setup callbacks for the page's lifetime and cannot drop one, so a hot
// update of this file would install Pinia and vue-i18n twice; reload the preview instead.
import.meta.hot?.dispose(() => location.reload())

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
