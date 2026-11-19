import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const electronHome = vi.hoisted(() => {
  const overrides = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']
  const saved = Object.fromEntries(overrides.map((name) => [name, process.env[name]]))
  for (const name of overrides) delete process.env[name]
  return { dir: '', saved }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () =>
      (electronHome.dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'first-build-auto-start-'))),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
    on: () => {}
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

import * as installations from '../installations'
import * as settings from '../settings'
import { pinAutoStartToALocalBuild, startFirstBuildWithDesktop } from './firstBuildAutoStart'

async function installedBuild(name: string, lastLaunchedAt?: number): Promise<string> {
  const entry = await installations.add({
    name,
    sourceId: 'standalone',
    status: 'installed',
    installPath: path.join(electronHome.dir, name),
    ...(lastLaunchedAt === undefined ? {} : { lastLaunchedAt })
  })
  return entry.id
}

afterEach(async () => {
  for (const inst of await installations.list()) await installations.remove(inst.id)
  settings.set('autoLaunchOnStartup', undefined)
  settings.set('autoStartAwaitingFirstStart', undefined)
})

afterAll(() => {
  for (const [name, value] of Object.entries(electronHome.saved)) {
    if (value !== undefined) process.env[name] = value
  }
  if (electronHome.dir) fs.rmSync(electronHome.dir, { recursive: true, force: true })
})

describe('Auto start for a first build', () => {
  it('gives the next first build Auto start after the old Auto start build was uninstalled', async () => {
    const removed = await installedBuild('Old GPU build')
    settings.set('autoLaunchOnStartup', removed)
    await installations.remove(removed)
    const fresh = await installedBuild('New GPU build')

    await startFirstBuildWithDesktop(fresh)

    expect(settings.get('autoLaunchOnStartup')).toBe(fresh)
    expect(settings.get('autoStartAwaitingFirstStart')).toBe(fresh)
  })

  it('gives the new build Auto start while the old Auto start build is being uninstalled', async () => {
    const leaving = await installedBuild('Old GPU build')
    settings.set('autoLaunchOnStartup', leaving)
    await installations.update(leaving, { status: 'partial-delete' })
    const fresh = await installedBuild('New GPU build')

    await startFirstBuildWithDesktop(fresh)

    expect(settings.get('autoLaunchOnStartup')).toBe(fresh)
  })

  it('leaves a picked build alone while that build is updating', async () => {
    const picked = await installedBuild('Picked')
    settings.set('autoLaunchOnStartup', picked)
    await installations.update(picked, { status: 'updating' })
    const fresh = await installedBuild('Only installed build')

    await startFirstBuildWithDesktop(fresh)

    expect(settings.get('autoLaunchOnStartup')).toBe(picked)
  })

  it('leaves a saved Last used build alone', async () => {
    settings.set('autoLaunchOnStartup', 'last')
    const fresh = await installedBuild('Only build')

    await startFirstBuildWithDesktop(fresh)

    expect(settings.get('autoLaunchOnStartup')).toBe('last')
  })
})

describe('a saved Last used build, now that only a build can be picked', () => {
  it('becomes the build that would have started, so its tile shows Auto start', async () => {
    await installedBuild('Older', 1_000)
    const recent = await installedBuild('Used yesterday', 2_000)
    settings.set('autoLaunchOnStartup', 'last')

    const started = await pinAutoStartToALocalBuild()

    expect(settings.get('autoLaunchOnStartup')).toBe(recent)
    expect(started?.id).toBe(recent)
  })

  it('becomes None when no build has ever started', async () => {
    await installedBuild('Never started')
    settings.set('autoLaunchOnStartup', 'last')

    await pinAutoStartToALocalBuild()

    expect(settings.get('autoLaunchOnStartup')).toBe('none')
  })

  it('leaves a picked build as it is', async () => {
    const picked = await installedBuild('Picked', 1_000)
    await installedBuild('Used more recently', 2_000)
    settings.set('autoLaunchOnStartup', picked)

    const started = await pinAutoStartToALocalBuild()

    expect(settings.get('autoLaunchOnStartup')).toBe(picked)
    expect(started?.id).toBe(picked)
  })

  it('becomes None when the build used last was Comfy Cloud', async () => {
    await installedBuild('Local', 1_000)
    await installations.add({
      name: 'Comfy Cloud',
      sourceId: 'cloud',
      status: 'installed',
      lastLaunchedAt: 2_000
    })
    settings.set('autoLaunchOnStartup', 'last')

    await pinAutoStartToALocalBuild()

    expect(settings.get('autoLaunchOnStartup')).toBe('none')
  })
})

describe('Comfy Cloud picked in the old Settings dropdown', () => {
  it('becomes None, since no tile can show or turn off Auto start on Cloud', async () => {
    const cloud = await installations.add({
      name: 'Comfy Cloud',
      sourceId: 'cloud',
      status: 'installed'
    })
    settings.set('autoLaunchOnStartup', cloud.id)

    const started = await pinAutoStartToALocalBuild()

    expect(settings.get('autoLaunchOnStartup')).toBe('none')
    expect(started).toBeNull()
  })
})

describe('the build Desktop starts when it opens', () => {
  it('is none when Auto start is off', async () => {
    await installedBuild('Idle', 1_000)

    expect(await pinAutoStartToALocalBuild()).toBeNull()
  })

  it('is none when the Auto start build no longer exists, and the setting is left for the next first build', async () => {
    settings.set('autoLaunchOnStartup', 'inst-gone')

    expect(await pinAutoStartToALocalBuild()).toBeNull()
    expect(settings.get('autoLaunchOnStartup')).toBe('inst-gone')
  })
})
