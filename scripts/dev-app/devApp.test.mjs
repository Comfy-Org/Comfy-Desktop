import { describe, expect, it } from 'vitest'
import { DEV_APP_BUNDLE_ENV as MAIN_DEV_APP_BUNDLE_ENV } from '../../src/main/apps/draftLinkStartup'
import {
  DEV_APP,
  DEV_APP_BUNDLE_ENV,
  devAppLinksWanted,
  devAppNeedsBuild,
  devAppPaths,
  devAppPlistEdits,
  devAppStamp,
  devServerLaunch
} from './devApp.mjs'

const STAMP_INPUT = {
  electronVersion: '45.3.2',
  name: DEV_APP.name,
  bundleId: DEV_APP.bundleId,
  scheme: DEV_APP.scheme,
  launcherSource: 'launcher'
}

describe('devAppPlistEdits', () => {
  it('names the bundle, gives it the dev id and claims the scheme', () => {
    expect(devAppPlistEdits(DEV_APP)).toEqual([
      ['CFBundleIdentifier', '-string', 'com.comfy.desktop.dev'],
      ['CFBundleName', '-string', 'Comfy Desktop Dev'],
      ['CFBundleDisplayName', '-string', 'Comfy Desktop Dev'],
      [
        'CFBundleURLTypes',
        '-json',
        '[{"CFBundleURLName":"com.comfy.desktop.dev","CFBundleURLSchemes":["comfy"]}]'
      ]
    ])
  })
})

describe('devAppNeedsBuild', () => {
  const wanted = devAppStamp(STAMP_INPUT)

  it('reuses a bundle built for the same Electron and launcher', () => {
    expect(devAppNeedsBuild(JSON.stringify(wanted, null, 2), wanted, true)).toBe(false)
  })

  it('rebuilds when the Electron version changed', () => {
    const old = devAppStamp({ ...STAMP_INPUT, electronVersion: '45.3.1' })
    expect(devAppNeedsBuild(JSON.stringify(old), wanted, true)).toBe(true)
  })

  it('rebuilds when the launcher changed', () => {
    const old = devAppStamp({ ...STAMP_INPUT, launcherSource: 'older launcher' })
    expect(devAppNeedsBuild(JSON.stringify(old), wanted, true)).toBe(true)
  })

  it('builds when the bundle or its stamp is missing or unreadable', () => {
    expect(devAppNeedsBuild(JSON.stringify(wanted), wanted, false)).toBe(true)
    expect(devAppNeedsBuild(null, wanted, true)).toBe(true)
    expect(devAppNeedsBuild('{', wanted, true)).toBe(true)
  })
})

describe('devAppLinksWanted', () => {
  it('wants the bundle on macOS by default', () => {
    expect(devAppLinksWanted('darwin', {})).toBe(true)
  })

  it.each([
    ['win32', {}],
    ['linux', {}],
    ['darwin', { COMFY_DRAFT_APP_LINKS: '0' }],
    ['darwin', { E2E: '1' }]
  ])('skips the bundle on %s with %o', (platform, env) => {
    expect(devAppLinksWanted(platform, env)).toBe(false)
  })
})

describe('devServerLaunch', () => {
  it('starts electron-vite dev from the clone on the dev bundle', () => {
    const paths = devAppPaths('/src/Comfy-Desktop/.dev-app', DEV_APP.name)
    expect(
      devServerLaunch({
        root: '/src/Comfy-Desktop',
        nodePath: '/usr/local/bin/node',
        electronViteCli: '/src/Comfy-Desktop/node_modules/electron-vite/bin/electron-vite.js',
        executable: paths.executable,
        bundle: paths.bundle,
        env: { PATH: '/usr/local/bin:/usr/bin' }
      })
    ).toEqual({
      command: [
        '/usr/local/bin/node',
        '/src/Comfy-Desktop/node_modules/electron-vite/bin/electron-vite.js',
        'dev',
        '--'
      ],
      cwd: '/src/Comfy-Desktop',
      env: {
        PATH: '/usr/local/bin:/usr/bin',
        ELECTRON_EXEC_PATH:
          '/src/Comfy-Desktop/.dev-app/Comfy Desktop Dev.app/Contents/MacOS/Electron',
        COMFY_DEV_APP_BUNDLE: '/src/Comfy-Desktop/.dev-app/Comfy Desktop Dev.app'
      }
    })
  })

  it('uses the same bundle env name as the main process', () => {
    expect(DEV_APP_BUNDLE_ENV).toBe(MAIN_DEV_APP_BUNDLE_ENV)
  })
})
