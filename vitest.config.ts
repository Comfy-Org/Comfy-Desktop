import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const INTEGRATION_TESTS = 'src/**/*.integration.test.ts'
const RENDERER_NODE_TESTS = [
  'src/renderer/csp.test.ts',
  'src/renderer/src/lib/localeCoverage.test.ts'
]

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
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'scripts/eslint/**/*.test.ts',
            ...RENDERER_NODE_TESTS
          ],
          exclude: [INTEGRATION_TESTS, 'node_modules']
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.ts'],
          exclude: [INTEGRATION_TESTS, 'node_modules', ...RENDERER_NODE_TESTS],
          setupFiles: ['./vitest.setup.ts']
        }
      }
    ]
  }
})
