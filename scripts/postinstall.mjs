#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function runInstallElectron() {
  let installElectronPath
  try {
    installElectronPath = require.resolve('electron/install.js')
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    // Production-only installs do not include the Electron development dependency.
    console.log('[postinstall] electron not installed; skipping install-electron')
    return 0
  }

  const result = spawnSync(process.execPath, [installElectronPath], { stdio: 'inherit' })
  if (typeof result.status === 'number') {
    return result.status
  }

  if (result.error) {
    console.error(`[postinstall] install-electron failed to start: ${result.error.message}`)
    return 1
  }

  if (result.signal) {
    console.error(`[postinstall] install-electron was terminated by signal: ${result.signal}`)
    return 1
  }

  console.error('[postinstall] install-electron failed with unknown status')
  return 1
}

function runInstallAppDeps() {
  const installAppDepsPath = require.resolve('electron-builder/install-app-deps.js')
  const result = spawnSync(process.execPath, [installAppDepsPath], { stdio: 'inherit' })
  if (typeof result.status === 'number') {
    return result.status
  }

  if (result.error) {
    console.error(`[postinstall] install-app-deps failed to start: ${result.error.message}`)
    return 1
  }

  if (result.signal) {
    console.error(`[postinstall] install-app-deps was terminated by signal: ${result.signal}`)
    return 1
  }

  console.error('[postinstall] install-app-deps failed with unknown status')
  return 1
}

const isToDesktopCI = process.env.TODESKTOP_CI === 'true'
const isToDesktopInitialInstall = process.env.TODESKTOP_INITIAL_INSTALL_PHASE === 'true'

if (isToDesktopCI) {
  if (isToDesktopInitialInstall) {
    console.log('[postinstall] ToDesktop initial install phase; skipping install-app-deps')
  } else {
    console.log('[postinstall] ToDesktop non-initial install phase; skipping install-app-deps')
  }
  process.exit(0)
}

// Electron 42 provisions its binary lazily; download it before launch/build timeouts.
const electronInstallStatus = runInstallElectron()
if (electronInstallStatus !== 0) process.exit(electronInstallStatus)

try {
  process.exit(runInstallAppDeps())
} catch {
  // Some CI/build environments install prod deps only, which excludes electron-builder.
  console.log('[postinstall] electron-builder not installed; skipping install-app-deps')
  process.exit(0)
}
