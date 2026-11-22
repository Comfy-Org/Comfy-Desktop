import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

export const DEV_DESKTOP_ENTRY_ENV = 'COMFY_DEV_DESKTOP_ENTRY'
export const LINUX_DEV_ENTRY = { name: 'Comfy Desktop Dev', scheme: 'comfy' }

const ENTRY_KEY_LENGTH = 12
const MIMEAPPS_SECTIONS = new Set(['[Default Applications]', '[Added Associations]'])

export function schemeMimeType(scheme) {
  return `x-scheme-handler/${scheme}`
}

export function desktopEntryFileName(root) {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, ENTRY_KEY_LENGTH)
  return `comfy-desktop-dev-${hash}.desktop`
}

function execArg(value) {
  const quoted = `"${value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%')}"`
  return quoted.replace(/\\/g, '\\\\')
}

function electronViteArgs(args) {
  const end = args.indexOf('--')
  return end < 0 ? args : args.slice(0, end)
}

function isNoSandboxFlag(arg) {
  if (arg === '--noSandbox') return true
  return arg.startsWith('--noSandbox=') && arg !== '--noSandbox=false'
}

export function devSandboxOff(env, args) {
  if (env['ELECTRON_DISABLE_SANDBOX'] === '1' || env['NO_SANDBOX'] === '1') return true
  return electronViteArgs(args).some(isNoSandboxFlag)
}

export function desktopEntryText({ name, scheme, executable, root, disableSandbox }) {
  const exec = disableSandbox
    ? [
        'env',
        'ELECTRON_DISABLE_SANDBOX=1',
        execArg(executable),
        execArg(root),
        '--no-sandbox',
        '%u'
      ]
    : [execArg(executable), execArg(root), '%u']
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    `Exec=${exec.join(' ')}`,
    `MimeType=${schemeMimeType(scheme)};`,
    'NoDisplay=true',
    'Terminal=false',
    ''
  ].join('\n')
}

export function mimeappsWithout(text, mimeType, fileName) {
  let section = ''
  const kept = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) section = trimmed
    const separator = line.indexOf('=')
    if (!MIMEAPPS_SECTIONS.has(section) || separator < 0) {
      kept.push(line)
      continue
    }
    if (line.slice(0, separator).trim() !== mimeType) {
      kept.push(line)
      continue
    }
    const handlers = line
      .slice(separator + 1)
      .split(';')
      .map((handler) => handler.trim())
      .filter(Boolean)
    if (!handlers.includes(fileName)) {
      kept.push(line)
      continue
    }
    const others = handlers.filter((handler) => handler !== fileName)
    if (others.length > 0) kept.push(`${mimeType}=${others.join(';')};`)
  }
  return kept.join('\n')
}

function applicationsDir(env) {
  const dataHome = env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share')
  return path.join(dataHome, 'applications')
}

function mimeappsFiles(env) {
  const configHome = env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config')
  return [path.join(configHome, 'mimeapps.list'), path.join(applicationsDir(env), 'mimeapps.list')]
}

function refreshDesktopDatabase(dir) {
  try {
    execFileSync('update-desktop-database', [dir], { stdio: 'ignore' })
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

function electronExecutable(root) {
  const require = createRequire(path.join(root, 'package.json'))
  const electronDir = path.dirname(require.resolve('electron/package.json'))
  const relative = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf-8').trim()
  return path.join(electronDir, 'dist', relative)
}

export function ensureLinuxDevEntry(root, env = process.env, args = []) {
  const dir = applicationsDir(env)
  const fileName = desktopEntryFileName(root)
  const text = desktopEntryText({
    ...LINUX_DEV_ENTRY,
    executable: electronExecutable(root),
    root,
    disableSandbox: devSandboxOff(env, args)
  })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, fileName), text)
  refreshDesktopDatabase(dir)
  execFileSync('xdg-mime', ['default', fileName, schemeMimeType(LINUX_DEV_ENTRY.scheme)], {
    stdio: 'ignore'
  })
  return fileName
}

export function removeLinuxDevEntry(root, env = process.env) {
  const dir = applicationsDir(env)
  const fileName = desktopEntryFileName(root)
  const mimeType = schemeMimeType(LINUX_DEV_ENTRY.scheme)
  for (const file of mimeappsFiles(env)) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf-8')
    const cleaned = mimeappsWithout(text, mimeType, fileName)
    if (cleaned !== text) fs.writeFileSync(file, cleaned)
  }
  const entry = path.join(dir, fileName)
  if (!fs.existsSync(entry)) return false
  fs.rmSync(entry)
  refreshDesktopDatabase(dir)
  return true
}
