import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import base from './vite.config.mjs'

const repo = resolve(fileURLToPath(import.meta.url), '../../..')

export default {
  ...base,
  base: './',
  build: {
    outDir: resolve(repo, 'dist-design'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(base.root, 'design-landing.html') }
  }
}
