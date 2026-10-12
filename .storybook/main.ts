import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import type { StorybookConfig } from '@storybook/vue3-vite'
import { mergeConfig } from 'vite'

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.ts'],
  staticDirs: [{ from: '../src/renderer/public/images', to: '/images' }],
  addons: ['@storybook/addon-docs', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/vue3-vite',
    // The preview wrapper has no props to document. The default vue-docgen-api is deprecated, and
    // vue-component-meta's HMR hook throws when a story edit updates the virtual stories module.
    options: { docgen: false }
  },
  core: { disableTelemetry: true },
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        alias: {
          '@renderer': resolve(import.meta.dirname, '../src/renderer/src'),
          '@locales': resolve(import.meta.dirname, '../locales')
        }
      },
      plugins: [vue(), tailwindcss()]
    })
  }
}

export default config
