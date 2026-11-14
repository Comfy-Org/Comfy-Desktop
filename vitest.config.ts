import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const RENDERER_TESTS_THAT_READ_FILES = [
  'src/renderer/csp.test.ts',
  'src/renderer/src/lib/localeCoverage.test.ts'
]
const INJECTED_PAGE_SCRIPT_TESTS = [
  'src/main/lib/comfyContentScript.test.ts',
  'src/main/lib/comfyTerminalContentScript.test.ts',
  'e2e/support/clickAim.test.ts'
]
const VUE_BUILD_THAT_COMPILES_TEMPLATE_STUBS = 'vue/dist/vue.esm-bundler.js'
const VUE_TEST_UTILS_STRING_SLOT_WARNING =
  '[@vue/compiler-core] decodeEntities option is passed but will be ignored in non-browser builds.'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@locales': resolve(__dirname, 'locales')
    }
  },
  test: {
    sequence: { hooks: 'list' },
    globals: true,
    maxWorkers: 8,
    onConsoleLog: (log) => !log.includes(VUE_TEST_UTILS_STRING_SLOT_WARNING),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          sequence: { groupOrder: 0 },
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'scripts/eslint/**/*.test.ts',
            ...RENDERER_TESTS_THAT_READ_FILES
          ],
          exclude: ['node_modules', ...INJECTED_PAGE_SCRIPT_TESTS]
        }
      },
      {
        extends: true,
        plugins: [tailwindcss()],
        resolve: {
          alias: [{ find: /^vue$/, replacement: VUE_BUILD_THAT_COMPILES_TEMPLATE_STUBS }]
        },
        test: {
          name: 'browser',
          sequence: { groupOrder: 1 },
          include: ['src/renderer/**/*.test.ts', ...INJECTED_PAGE_SCRIPT_TESTS],
          exclude: ['node_modules', ...RENDERER_TESTS_THAT_READ_FILES],
          setupFiles: ['./vitest.setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
          }
        }
      }
    ]
  }
})
