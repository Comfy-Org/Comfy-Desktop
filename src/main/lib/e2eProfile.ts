import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// This module must run before settings or other profile-backed modules load.
// HOME alone does not redirect Electron's userData on macOS.
const profileDir = process.env['E2E_USER_DATA_DIR']
if (process.env['E2E'] === '1' && !app.isPackaged && profileDir) {
  if (!path.isAbsolute(profileDir)) {
    throw new Error('E2E_USER_DATA_DIR must be an absolute path')
  }
  mkdirSync(profileDir, { recursive: true })
  app.setPath('userData', profileDir)
  app.setPath('sessionData', profileDir)
}
