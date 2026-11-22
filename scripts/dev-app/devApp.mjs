import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEV_APP = {
  name: 'Comfy Desktop Dev',
  bundleId: 'com.comfy.desktop.dev',
  scheme: 'comfy',
  dir: '.dev-app'
}

export const DEV_APP_BUNDLE_ENV = 'COMFY_DEV_APP_BUNDLE'

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const LAUNCHER_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'launcher.mjs')
const STAMP_FILE = 'dev-app.json'
const LAUNCH_FILE = 'launch.json'
const LAUNCHER_PACKAGE = { name: 'electron', productName: 'Electron', main: 'launcher.mjs' }

export function devAppLinksWanted(platform, env) {
  return platform === 'darwin' && env['COMFY_DRAFT_APP_LINKS'] !== '0' && env['E2E'] !== '1'
}

export function devAppPlistEdits({ name, bundleId, scheme }) {
  return [
    ['CFBundleIdentifier', '-string', bundleId],
    ['CFBundleName', '-string', name],
    ['CFBundleDisplayName', '-string', name],
    [
      'CFBundleURLTypes',
      '-json',
      JSON.stringify([{ CFBundleURLName: bundleId, CFBundleURLSchemes: [scheme] }])
    ]
  ]
}

export function devAppStamp({ electronVersion, name, bundleId, scheme, launcherSource }) {
  return {
    electronVersion,
    name,
    bundleId,
    scheme,
    launcher: createHash('sha256').update(launcherSource).digest('hex')
  }
}

export function devAppNeedsBuild(stampText, wanted, bundleExists) {
  if (!bundleExists || stampText === null) return true
  try {
    return JSON.stringify(JSON.parse(stampText)) !== JSON.stringify(wanted)
  } catch {
    return true
  }
}

export function devAppPaths(outDir, name) {
  const bundle = path.join(outDir, `${name}.app`)
  return {
    bundle,
    executable: path.join(bundle, 'Contents', 'MacOS', 'Electron'),
    plist: path.join(bundle, 'Contents', 'Info.plist'),
    launcherDir: path.join(bundle, 'Contents', 'Resources', 'app'),
    stamp: path.join(outDir, STAMP_FILE),
    launch: path.join(outDir, LAUNCH_FILE),
    launcherData: path.join(outDir, 'launcher-data'),
    log: path.join(outDir, 'cold-start.log')
  }
}

export function devServerLaunch({ root, nodePath, electronViteCli, executable, bundle, env }) {
  return {
    command: [nodePath, electronViteCli, 'dev', '--'],
    cwd: root,
    env: {
      PATH: env['PATH'] ?? '',
      ELECTRON_EXEC_PATH: executable,
      [DEV_APP_BUNDLE_ENV]: bundle
    }
  }
}

function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

function buildBundle({ electronApp, paths, name, bundleId, scheme, launcherSource }) {
  fs.rmSync(paths.bundle, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(paths.bundle), { recursive: true })
  execFileSync('cp', ['-c', '-R', electronApp, paths.bundle])
  for (const [key, type, value] of devAppPlistEdits({ name, bundleId, scheme })) {
    execFileSync('plutil', ['-replace', key, type, value, paths.plist])
  }
  fs.mkdirSync(paths.launcherDir, { recursive: true })
  fs.writeFileSync(path.join(paths.launcherDir, 'launcher.mjs'), launcherSource)
  fs.writeFileSync(
    path.join(paths.launcherDir, 'package.json'),
    `${JSON.stringify(LAUNCHER_PACKAGE, null, 2)}\n`
  )
  execFileSync('codesign', ['--force', '--deep', '-s', '-', paths.bundle], { stdio: 'ignore' })
}

export function ensureDevApp({
  outDir,
  electronApp,
  electronVersion,
  launch,
  name = DEV_APP.name,
  bundleId = DEV_APP.bundleId,
  scheme = DEV_APP.scheme
}) {
  const paths = devAppPaths(outDir, name)
  const launcherSource = fs.readFileSync(LAUNCHER_SOURCE, 'utf-8')
  const wanted = devAppStamp({ electronVersion, name, bundleId, scheme, launcherSource })
  const built = devAppNeedsBuild(readTextOrNull(paths.stamp), wanted, fs.existsSync(paths.bundle))
  if (built) {
    fs.rmSync(paths.stamp, { force: true })
    buildBundle({ electronApp, paths, name, bundleId, scheme, launcherSource })
    fs.writeFileSync(paths.stamp, `${JSON.stringify(wanted, null, 2)}\n`)
  }
  const resolvedLaunch =
    typeof launch === 'function'
      ? launch({ executable: paths.executable, bundle: paths.bundle })
      : launch
  fs.writeFileSync(
    paths.launch,
    `${JSON.stringify({ ...resolvedLaunch, log: paths.log, userData: paths.launcherData }, null, 2)}\n`
  )
  execFileSync(LSREGISTER, ['-f', paths.bundle])
  return { ...paths, built }
}

export function unregisterDevApp(outDir, name = DEV_APP.name) {
  const { bundle } = devAppPaths(outDir, name)
  if (!fs.existsSync(bundle)) return false
  execFileSync(LSREGISTER, ['-u', bundle])
  return true
}

export function ensureCloneDevApp(root, env = process.env) {
  const require = createRequire(path.join(root, 'package.json'))
  const electronDir = path.dirname(require.resolve('electron/package.json'))
  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(electronDir, 'package.json'), 'utf-8')
  ).version
  const electronExecutable = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf-8').trim()
  const electronApp = path.join(electronDir, 'dist', electronExecutable.split('/')[0])
  const electronViteDir = path.dirname(require.resolve('electron-vite/package.json'))
  const electronViteBin = JSON.parse(
    fs.readFileSync(path.join(electronViteDir, 'package.json'), 'utf-8')
  ).bin['electron-vite']
  return ensureDevApp({
    outDir: path.join(root, DEV_APP.dir),
    electronApp,
    electronVersion,
    launch: ({ executable, bundle }) =>
      devServerLaunch({
        root,
        nodePath: process.execPath,
        electronViteCli: path.join(electronViteDir, electronViteBin),
        executable,
        bundle,
        env
      })
  })
}
