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
      // Two pages ship: the prototype, and the design system beside it
      // (vercel.json rewrites /ds to it, so it has a short address).
      input: {
        landing: resolve(base.root, 'design-landing.html'),
        ds: resolve(base.root, 'src/design/landing/mar/ds/index.html')
      }
    }
  }
}
