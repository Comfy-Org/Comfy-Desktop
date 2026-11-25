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
    rollupOptions: {
      // Three pages ship: the prototype, the design system beside it
      // (/ds) and the index of links to both (/links).
      input: {
        landing: resolve(base.root, 'design-landing.html'),
        ds: resolve(base.root, 'src/design/landing/mar/ds/index.html'),
        links: resolve(base.root, 'design-index.html')
      }
    }
  }
}
