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
import {
  DEV_DESKTOP_ENTRY_ENV,
  LINUX_DEV_ENTRY,
  devSandboxOff,
  ensureLinuxDevEntry,
  removeLinuxDevEntry
} from './dev-app/linuxEntry.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_VITE_ARGS = process.argv.slice(2)
const SANDBOX_OFF = await devSandboxOff(process.env, ELECTRON_VITE_ARGS, ROOT)

function warn(message) {
  console.warn(`\n\x1b[33m⚠ ${message}\x1b[0m\n`)
}

function linuxDevEntryEnv() {
  if (process.env['COMFY_DRAFT_APP_LINKS'] === '0') {
    try {
      removeLinuxDevEntry(ROOT)
    } catch (err) {
      warn(`Could not remove the ${LINUX_DEV_ENTRY.name} desktop entry: ${err.message}`)
    }
    return {}
  }
  if (process.env['E2E'] === '1') return {}
  try {
    return { [DEV_DESKTOP_ENTRY_ENV]: ensureLinuxDevEntry(ROOT, process.env, SANDBOX_OFF) }
  } catch (err) {
    warn(
      `Could not set up the ${LINUX_DEV_ENTRY.name} desktop entry, so ${LINUX_DEV_ENTRY.scheme}:// links will not reach this copy. ${err.message}`
    )
    return {}
  }
}

function devAppEnv() {
  if (process.platform === 'linux') return linuxDevEntryEnv()
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

const child = spawn(process.execPath, [electronViteCli(), 'dev', ...ELECTRON_VITE_ARGS], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ...(SANDBOX_OFF ? { NO_SANDBOX: '1' } : {}), ...devAppEnv() }
})
const FORWARDED_SIGNALS =
  process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP']
for (const signal of FORWARDED_SIGNALS) {
  process.on(signal, () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill(signal)
  })
}
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
