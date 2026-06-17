import path from 'path'
import { app } from 'electron'

/** Resolve a bundled Python script's path. Packaged: `resourcesPath/lib/`;
 *  dev: two levels below `out/main/` where `lib/` lives. */
export function getBundledScriptPath(scriptName: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'lib', scriptName)
    : path.join(__dirname, '..', '..', 'lib', scriptName)
}

/** Resolve a bundled template input asset's path (e.g. a `LoadImage` sample
 *  shipped under `lib/template-assets/`). Same `lib/` root + dev/packaged split
 *  as `getBundledScriptPath`. */
export function getBundledTemplateAssetPath(assetName: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'lib', 'template-assets', assetName)
    : path.join(__dirname, '..', '..', 'lib', 'template-assets', assetName)
}
