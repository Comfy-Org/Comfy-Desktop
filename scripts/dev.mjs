import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEV_APP,
  DEV_APP_BUNDLE_ENV,
  devAppLinksWanted,
  ensureCloneDevApp,
  unregisterDevApp
} from './dev-app/devApp.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function warn(message) {
  console.warn(`\n\x1b[33m⚠ ${message}\x1b[0m\n`)
}

function devAppEnv() {
  if (process.platform !== 'darwin') return {}
  if (process.env['COMFY_DRAFT_APP_LINKS'] === '0') {
    try {
      unregisterDevApp(path.join(ROOT, DEV_APP.dir))
    } catch (err) {
      warn(`Could not unregister ${DEV_APP.name}: ${err.message}`)
    }
    return {}
  }
  if (!devAppLinksWanted(process.platform, process.env)) return {}
  try {
    const devApp = ensureCloneDevApp(ROOT)
    return { ELECTRON_EXEC_PATH: devApp.executable, [DEV_APP_BUNDLE_ENV]: devApp.bundle }
  } catch (err) {
    warn(
      `Could not set up ${DEV_APP.name}, so ${DEV_APP.scheme}:// links will not reach this copy. Starting plain Electron. ${err.message}`
    )
    return {}
  }
}

function electronViteCli() {
  const require = createRequire(path.join(ROOT, 'package.json'))
  const packageJson = require.resolve('electron-vite/package.json')
  const { bin } = JSON.parse(fs.readFileSync(packageJson, 'utf-8'))
  return path.join(path.dirname(packageJson), bin['electron-vite'])
}

const child = spawn(process.execPath, [electronViteCli(), 'dev', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ...devAppEnv() }
})
process.on('SIGINT', () => {})
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
