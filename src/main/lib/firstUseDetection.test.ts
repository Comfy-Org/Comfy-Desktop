import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpRoot = ''
let userDataPath = ''

async function loadStartup() {
  const installations = await import('../installations')
  const { detectFirstUseState } = await import('./firstUseDetection')
  return { installations, detectFirstUseState }
}

const CLOUD = {
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  remoteUrl: 'https://cloud.comfy.org/',
  launchMode: 'window',
  browserPartition: 'shared'
}

function legacyDesktop(): Record<string, unknown> {
  return {
    name: 'ComfyUI Legacy Desktop',
    sourceId: 'desktop',
    installPath: path.join(tmpRoot, 'legacy'),
    launchMode: 'external',
    status: 'installed'
  }
}

function holdNextWriteAtItsRename(): { reached: Promise<void>; land: () => void } {
  const realRename = fs.promises.rename.bind(fs.promises)
  let markReached: () => void = () => {}
  const reached = new Promise<void>((resolve) => {
    markReached = resolve
  })
  let land: () => void = () => {}
  const allowed = new Promise<void>((resolve) => {
    land = resolve
  })
  vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async (from, to) => {
    markReached()
    await allowed
    return realRename(from, to)
  })
  return { reached, land }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-desktop-2-first-use-'))
  userDataPath = path.join(tmpRoot, 'user-data')
  fs.mkdirSync(userDataPath, { recursive: true })

  vi.resetModules()
  vi.restoreAllMocks()
  vi.doMock('electron', () => ({
    app: {
      getPath: () => userDataPath
    }
  }))
  vi.stubGlobal('process', {
    ...process,
    platform: 'win32'
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('what Set up is told about the builds already on this computer', () => {
  it('has nothing to offer on a computer with only Comfy Cloud', async () => {
    const { installations, detectFirstUseState } = await loadStartup()
    await installations.seedDefaults([CLOUD])

    expect(await detectFirstUseState()).toEqual({ skipPick: false, hasLegacyDesktop: false })
  })

  it('offers to migrate a legacy ComfyUI Desktop install found at startup', async () => {
    const { installations, detectFirstUseState } = await loadStartup()
    await installations.seedDefaults([CLOUD])
    await installations.ensureExists('desktop', legacyDesktop())

    expect(await detectFirstUseState()).toEqual({ skipPick: false, hasLegacyDesktop: true })
  })

  it('offers to migrate a legacy install that startup is still adding to the builds list', async () => {
    const { installations, detectFirstUseState } = await loadStartup()
    await installations.seedDefaults([CLOUD])
    const disk = holdNextWriteAtItsRename()
    const adding = installations.ensureExists('desktop', legacyDesktop())
    const asked = detectFirstUseState()

    await disk.reached
    disk.land()

    expect(await asked).toEqual({ skipPick: false, hasLegacyDesktop: true })
    await adding
  })

  it('lets someone who already has a build keep it', async () => {
    const { installations, detectFirstUseState } = await loadStartup()
    await installations.seedDefaults([CLOUD])
    await installations.add({
      name: 'ComfyUI',
      installPath: path.join(tmpRoot, 'build'),
      sourceId: 'standalone',
      status: 'installed'
    })

    expect(await detectFirstUseState()).toEqual({ skipPick: true, hasLegacyDesktop: false })
  })
})
