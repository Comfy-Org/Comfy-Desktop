import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ReleaseInfo {
  releaseNotes?: string
  minimumSystemVersion?: string
}

interface PackContext {
  electronPlatformName: string
  appOutDir: string
  packager: {
    config: { releaseInfo?: ReleaseInfo }
    platformSpecificBuildOptions: { releaseInfo?: ReleaseInfo }
    getResourcesDir: (appOutDir: string) => string
  }
}

interface AfterPackModule {
  default: (context: PackContext) => Promise<void>
}

const APP_BUNDLE = 'Comfy Desktop.app'
const afterPackUrl = pathToFileURL(path.join(process.cwd(), 'scripts', 'afterPack.mjs')).href
const packedApps: string[] = []

function packedMacApp(minimumMacOS: string | null): string {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packed-mac-app-'))
  packedApps.push(appOutDir)
  const contentsDir = path.join(appOutDir, APP_BUNDLE, 'Contents')
  fs.mkdirSync(contentsDir, { recursive: true })
  const minimumSystemEntry =
    minimumMacOS === null
      ? ''
      : `\t<key>LSMinimumSystemVersion</key>\n\t<string>${minimumMacOS}</string>\n`
  fs.writeFileSync(
    path.join(contentsDir, 'Info.plist'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0">',
      '<dict>',
      '\t<key>CFBundleName</key>',
      '\t<string>Comfy Desktop</string>',
      `${minimumSystemEntry}</dict>`,
      '</plist>',
      ''
    ].join('\n')
  )
  return appOutDir
}

function macPackContext(appOutDir: string, releaseInfo?: ReleaseInfo): PackContext {
  return {
    electronPlatformName: 'darwin',
    appOutDir,
    packager: {
      config: { releaseInfo },
      platformSpecificBuildOptions: {},
      getResourcesDir: (dir) => path.join(dir, APP_BUNDLE, 'Contents', 'Resources')
    }
  }
}

async function runAfterPack(context: PackContext): Promise<void> {
  const hook = (await import(afterPackUrl)) as AfterPackModule
  await hook.default(context)
}

describe('the macOS update manifest', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of packedApps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('holds an update back from a Mac older than the packaged app itself supports', async () => {
    const context = macPackContext(packedMacApp('13.0'), { releaseNotes: 'What changed' })

    await runAfterPack(context)

    expect(context.packager.platformSpecificBuildOptions.releaseInfo).toEqual({
      releaseNotes: 'What changed',
      minimumSystemVersion: '22.0.0'
    })
  })

  it('follows the app when a later Electron raises the macOS it needs', async () => {
    const context = macPackContext(packedMacApp('26.0'))

    await runAfterPack(context)

    expect(context.packager.platformSpecificBuildOptions.releaseInfo?.minimumSystemVersion).toBe(
      '25.0.0'
    )
  })

  it('fails the build when the app needs a macOS whose Darwin version is not known', async () => {
    const context = macPackContext(packedMacApp('99.0'))

    await expect(runAfterPack(context)).rejects.toThrow('no Darwin version known for macOS 99.0')
  })

  it('fails the build when the app does not say which macOS it needs', async () => {
    const context = macPackContext(packedMacApp(null))

    await expect(runAfterPack(context)).rejects.toThrow('LSMinimumSystemVersion not found')
  })
})
