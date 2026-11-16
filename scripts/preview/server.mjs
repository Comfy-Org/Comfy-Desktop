import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { createServer } from 'vite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const PREVIEW_PAGE = '/preview.html'

export async function startPreviewServer({ port = 0, open = false, watch = false } = {}) {
  const server = await createServer({
    configFile: false,
    root: path.join(repoRoot, 'src', 'renderer'),
    logLevel: 'warn',
    clearScreen: false,
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': path.join(repoRoot, 'src', 'renderer', 'src'),
        '@locales': path.join(repoRoot, 'locales')
      }
    },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: port !== 0,
      open: open ? PREVIEW_PAGE : false,
      hmr: watch,
      watch: watch ? undefined : null,
      fs: { allow: [repoRoot] }
    }
  })
  await server.listen()
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`
  return { origin, url: `${origin}${PREVIEW_PAGE}`, close: () => server.close() }
}
