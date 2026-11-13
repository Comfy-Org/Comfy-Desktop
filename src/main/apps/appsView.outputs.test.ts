import { mkdtempSync, promises as fsp, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const outputDir = vi.hoisted(() => ({ current: '' }))
const appEvents = vi.hoisted(() => ({ trackApps: vi.fn(), trackFromPage: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: true },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  WebContentsView: vi.fn()
}))
vi.mock('../cloud/config', () => ({
  CLOUD_CONFIG: { apiBase: 'https://cloud.test/api', issuer: 'https://cloud.test' }
}))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    getAccessToken: async () => 'token',
    status: () => ({ signedIn: true })
  })
}))
vi.mock('../host/registry', () => ({ comfyWindows: new Map() }))
vi.mock('../lib/ipc/registerDevPlatformHandlers', () => ({ signInToCloud: vi.fn() }))
vi.mock('../settings', () => ({ get: () => outputDir.current }))
vi.mock('./localComfy', () => ({
  cancelSetup: vi.fn(),
  getLocal: vi.fn(),
  initLocalComfy: vi.fn(),
  localDownload: vi.fn(),
  localFetch: vi.fn(),
  startLocal: vi.fn(),
  syncLocalSocket: vi.fn()
}))
vi.mock('./openInComfy', () => ({ localBuilds: vi.fn(), openInComfy: vi.fn() }))
vi.mock('./appsSwitch', () => ({ isAppsEnabled: () => true }))
vi.mock('./appEvents', () => appEvents)

import { getOutput, saveFile } from './appsView'

const PNG = new Uint8Array([137, 80, 78, 71])
const OUTPUT = { filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }

function cloudAnswers(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(PNG, { headers: { 'content-type': 'image/png' } }))
  )
}

function failNextWrite(): void {
  vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(
    Object.assign(new Error('disk full'), { code: 'ENOSPC' })
  )
}

function failNextOpen(): void {
  vi.spyOn(fsp, 'open').mockRejectedValueOnce(
    Object.assign(new Error('disk full'), { code: 'ENOSPC' })
  )
}

beforeEach(() => {
  outputDir.current = mkdtempSync(path.join(tmpdir(), 'apps-view-test-'))
  appEvents.trackApps.mockReset()
  cloudAnswers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(outputDir.current, { recursive: true, force: true })
})

describe('getOutput', () => {
  it('sends output_saved from the cloud after it saves the result', async () => {
    const got = await getOutput(OUTPUT, { app: 'upscale', label: 'my result' })

    expect(got.path).toBeDefined()
    expect(await fsp.readFile(got.path!)).toEqual(Buffer.from(PNG))
    expect(appEvents.trackApps).toHaveBeenCalledExactlyOnceWith('output_saved', {
      app: 'upscale',
      where: 'cloud'
    })
  })

  it('sends nothing for a read that does not save', async () => {
    const got = await getOutput(OUTPUT)

    expect(got.path).toBeUndefined()
    expect(appEvents.trackApps).not.toHaveBeenCalled()
  })

  it('sends nothing when the write fails', async () => {
    failNextOpen()

    await expect(getOutput(OUTPUT, { app: 'upscale', label: 'my result' })).rejects.toThrow(
      'disk full'
    )
    expect(appEvents.trackApps).not.toHaveBeenCalled()
  })

  it('keeps the saved result when tracking throws', async () => {
    appEvents.trackApps.mockImplementation(() => {
      throw new Error('telemetry down')
    })

    const got = await getOutput(OUTPUT, { app: 'upscale', label: 'my result' })

    expect(got.type).toBe('image/png')
    expect(await fsp.readFile(got.path!)).toEqual(Buffer.from(PNG))
  })
})

describe('saveFile', () => {
  it('sends output_saved with where the run happened after it saves the file', async () => {
    const got = await saveFile(PNG, 'text-to-image', 'my result', 'png', 'local')

    expect(await fsp.readFile(got.path)).toEqual(Buffer.from(PNG))
    expect(appEvents.trackApps).toHaveBeenCalledExactlyOnceWith('output_saved', {
      app: 'text-to-image',
      where: 'local'
    })
  })

  it('sends nothing when the page does not say where the run happened', async () => {
    const got = await saveFile(PNG, 'text-to-image', 'workflow', 'json')

    expect(got.path).toBeDefined()
    expect(appEvents.trackApps).not.toHaveBeenCalled()
  })

  it('sends nothing when the write fails', async () => {
    failNextWrite()

    await expect(saveFile(PNG, 'text-to-image', 'my result', 'png', 'local')).rejects.toThrow(
      'disk full'
    )
    expect(appEvents.trackApps).not.toHaveBeenCalled()
  })

  it('sends nothing when it refuses the file', async () => {
    await expect(saveFile(PNG, 'text-to-image', 'my result', 'exe', 'local')).rejects.toThrow(
      'Apps cannot save that file.'
    )
    expect(appEvents.trackApps).not.toHaveBeenCalled()
  })

  it('keeps the saved path when tracking throws', async () => {
    appEvents.trackApps.mockImplementation(() => {
      throw new Error('telemetry down')
    })

    const got = await saveFile(PNG, 'text-to-image', 'my result', 'png', 'cloud')

    expect(await fsp.readFile(got.path)).toEqual(Buffer.from(PNG))
  })
})
