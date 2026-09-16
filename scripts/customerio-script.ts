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
        define: {
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
          localStorage: '__desktopCioLocalStorage',
          'window.localStorage': '__desktopCioLocalStorage',
          'globalThis.localStorage': '__desktopCioLocalStorage',
          sessionStorage: '__desktopCioSessionStorage',
          'window.sessionStorage': '__desktopCioSessionStorage',
          'globalThis.sessionStorage': '__desktopCioSessionStorage'
        }
      })
      for (const file of Object.keys(result.metafile!.inputs)) this.addWatchFile(resolve(file))
      const storage = `function storage(){const m=new Map();return {get length(){return m.size},clear(){m.clear()},getItem(k){return m.get(k)??null},key(i){return [...m.keys()][i]??null},removeItem(k){m.delete(k)},setItem(k,v){m.set(k,String(v))}}}`
      const source = `(()=>{${storage};const __desktopCioLocalStorage=storage(),__desktopCioSessionStorage=storage();${result.outputFiles[0]!.text}})();`
      return `export default ${JSON.stringify(source)}`
    }
  }
}
