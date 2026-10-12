import { createPinia, disposePinia } from 'pinia'
import { nextTick, type App } from 'vue'
import { setup, type Preview } from '@storybook/vue3-vite'
import { createAppI18n } from '../src/renderer/src/lib/i18nFactory'
import '../src/renderer/src/assets/main.css'

function installPlugins(app: App): void {
  const pinia = createPinia()
  app.use(pinia)
  // Pinia outlives its app, so stores would keep their subscriptions (to preload events, say).
  // onUnmount runs before the tree unmounts; wait so components' unmount hooks can still use stores.
  app.onUnmount(() => void nextTick(() => disposePinia(pinia)))
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
    // Popovers and takeover screens teleport to body. On the generated Docs page,
    // separate iframes run each story's play function and isolate its stores and
    // any preload API sample; `docs.story.autoplay` applies only to inline stories.
    docs: { story: { inline: false, height: '800px' } }
  },
  beforeEach() {
    document.documentElement.dataset.theme = 'dark'
  }
}

export default preview
