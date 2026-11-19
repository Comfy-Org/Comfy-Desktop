import path from 'path'
import { app } from 'electron'

export function getBundledScriptPath(scriptName: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'lib', scriptName)
    : path.join(__dirname, '..', '..', 'lib', scriptName)
}
