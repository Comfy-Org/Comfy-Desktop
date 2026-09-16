import { resolve } from 'node:path'
import { build } from 'esbuild'
import type { Plugin } from 'vite'

/** Bundle a browser-only SDK into the preload as data, never as privileged preload code. */
export function customerIoScriptPlugin(): Plugin {
  return {
    name: 'desktop-customerio-script',
    resolveId(id) {
      if (id === 'virtual:customerio-script') return '\0' + id
    },
    async load(id) {
      if (id !== '\0virtual:customerio-script') return
      const result = await build({
        entryPoints: [resolve(__dirname, '../src/renderer/src/customerIo/index.ts')],
        bundle: true,
        // The SDK's sideEffects:false annotation drops its statically re-exported
        // in-app module initializer in an IIFE bundle. Keep that initialization.
        ignoreAnnotations: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'chrome144',
        minify: true,
        metafile: true,
        inject: [resolve(__dirname, '../src/renderer/src/customerIo/environment.ts')],
        define: {
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
          localStorage: 'sdkLocalStorage',
          'window.localStorage': 'sdkLocalStorage',
          'globalThis.localStorage': 'sdkLocalStorage',
          sessionStorage: 'sdkSessionStorage',
          'window.sessionStorage': 'sdkSessionStorage',
          'globalThis.sessionStorage': 'sdkSessionStorage',
          location: 'sdkLocation',
          'window.location': 'sdkLocation',
          'globalThis.location': 'sdkLocation',
          'document.location': 'sdkLocation',
          'document.URL': 'sdkLocation.href',
          'document.documentURI': 'sdkLocation.href',
          'document.referrer': '""'
        }
      })
      for (const file of Object.keys(result.metafile!.inputs)) this.addWatchFile(resolve(file))
      return `export default ${JSON.stringify(result.outputFiles[0]!.text)}`
    }
  }
}
