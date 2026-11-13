#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function urlFromFile() {
  try {
    return readFileSync(path.join(root, '.apps-url'), 'utf8').trim()
  } catch {
    return ''
  }
}

const appsUrl = process.env.COMFY_APPS_URL || urlFromFile()
const env = appsUrl ? { ...process.env, COMFY_APPS_URL: appsUrl } : { ...process.env }

const electronVite = path.join(
  path.dirname(require.resolve('electron-vite/package.json')),
  'bin',
  'electron-vite.js'
)
const build = spawnSync(process.execPath, [electronVite, 'build'], {
  cwd: root,
  stdio: 'inherit',
  env
})
if (build.status !== 0) process.exit(build.status ?? 1)

console.log(
  appsUrl
    ? `[apps] Apps page: ${appsUrl}`
    : "[apps] No apps address set (COMFY_APPS_URL or a .apps-url file); using Desktop's built-in one."
)
const electron = require('electron')
const app = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env })
app.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
