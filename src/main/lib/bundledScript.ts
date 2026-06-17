import path from 'path'
import { app } from 'electron'

/** Root of the bundled `lib/` dir. Packaged: `resourcesPath/lib/`; dev: two
 *  levels below `out/main/` where `lib/` lives. */
function getBundledLibRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'lib')
    : path.join(__dirname, '..', '..', 'lib')
}

/** Resolve a bundled Python script's path under `lib/`. */
export function getBundledScriptPath(scriptName: string): string {
  return path.join(getBundledLibRoot(), scriptName)
}

/** Resolve a bundled template input asset's path (e.g. a `LoadImage` sample
 *  shipped under `lib/template-assets/`). */
export function getBundledTemplateAssetPath(assetName: string): string {
  return path.join(getBundledLibRoot(), 'template-assets', assetName)
}
