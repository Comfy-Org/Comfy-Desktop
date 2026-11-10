// @vitest-environment node
import path from 'path'
import { describe, expect, it } from 'vitest'

import {
  APPS_BUILD_IDLE_MS,
  APPS_BUILD_RELEASE,
  APPS_SETUP_STAGE,
  appsLaunchArgs,
  appsModelDirs,
  appsOutputDir,
  downloadBytes,
  FREE_IDLE_MS,
  FREE_JSON,
  findAppsBuild,
  freeWait,
  isRunEnd,
  LINUX_NO_GPU,
  localOff,
  MAC_GPU_ONLY_ARG,
  MAC_GPU_ONLY_MIN_BYTES,
  MAC_NO_GPU,
  pickOpenTarget,
  pickVariant,
  queueEmpty,
  setupEnd,
  setupEvent,
  shouldStopIdle
} from './appsBuildRules'
import { localInstalls } from './guards'

const category = (inst: { sourceId: string }) =>
  ({ standalone: 'local', git: 'local', desktop: 'local', cloud: 'cloud' })[inst.sourceId]

describe('the pinned release', () => {
  it('is one ComfyUI bundle tag', () => {
    expect(APPS_BUILD_RELEASE).toMatch(/^v\d+\.\d+\.\d+-env\d+$/)
  })
})

describe('localOff', () => {
  it('turns This computer off on Linux with no supported GPU', () => {
    expect(localOff('linux', null)).toBe(LINUX_NO_GPU)
    expect(localOff('linux', undefined)).toBe(LINUX_NO_GPU)
    expect(localOff('linux', 'mps')).toBe(LINUX_NO_GPU)
  })

  it('keeps This computer on Linux with NVIDIA, AMD or Intel Arc', () => {
    for (const gpu of ['nvidia', 'amd', 'intel']) expect(localOff('linux', gpu), gpu).toBeNull()
  })

  it('says why in one line', () => {
    expect(LINUX_NO_GPU).toBe('This computer needs an NVIDIA, AMD or Intel Arc GPU on Linux.')
  })

  it('turns it off on a Mac without Apple Silicon', () => {
    expect(localOff('darwin', null)).toBe(MAC_NO_GPU)
    expect(localOff('darwin', 'mps')).toBeNull()
  })

  it('leaves Windows on, with or without a GPU', () => {
    expect(localOff('win32', null)).toBeNull()
    expect(localOff('win32', 'nvidia')).toBeNull()
  })
})

describe('findAppsBuild', () => {
  it('finds the Apps build by its record mark, not its name', () => {
    const list = [
      { id: 'mine', name: 'Apps', sourceId: 'standalone' },
      { id: 'apps', name: 'Renamed by the person', sourceId: 'standalone', appsBuild: true }
    ]
    expect(findAppsBuild(list)?.id).toBe('apps')
  })

  it('finds none when no record is marked', () => {
    expect(findAppsBuild([{ id: 'a', appsBuild: 'true' }, { id: 'b' }])).toBeNull()
  })
})

describe('appsOutputDir', () => {
  const places = {
    dataRoot: '/Users/v',
    appData: '/Users/v/Library/Application Support/comfyui-desktop-2',
    sharedOutput: '/Users/v/ComfyUI-Shared/output',
    installPath: '/Users/v/ComfyUI-Installs/Apps'
  }

  it('puts results next to the shared folders, in their own folder', () => {
    expect(appsOutputDir(places, path.posix)).toBe('/Users/v/ComfyUI-Apps/output')
  })

  it('is never the shared output folder or inside the build folder', () => {
    const dir = appsOutputDir(places, path.posix)
    expect(dir.startsWith(places.sharedOutput)).toBe(false)
    expect(dir.startsWith(places.installPath + '/')).toBe(false)
  })

  it('moves to the app data folder when the shared output folder would hold it', () => {
    expect(appsOutputDir({ ...places, sharedOutput: '/Users/v/ComfyUI-Apps' }, path.posix)).toBe(
      '/Users/v/Library/Application Support/comfyui-desktop-2/ComfyUI-Apps/output'
    )
  })

  it('moves when the build folder would hold it', () => {
    expect(appsOutputDir({ ...places, installPath: '/Users/v/ComfyUI-Apps' }, path.posix)).toBe(
      '/Users/v/Library/Application Support/comfyui-desktop-2/ComfyUI-Apps/output'
    )
  })

  it('works with Windows paths', () => {
    const dir = appsOutputDir(
      {
        dataRoot: 'C:\\',
        appData: 'C:\\Users\\v\\AppData\\Roaming\\comfyui-desktop-2',
        sharedOutput: 'C:\\ComfyUI-Shared\\output',
        installPath: 'C:\\ComfyUI-Installs\\Apps'
      },
      path.win32
    )
    expect(dir).toBe('C:\\ComfyUI-Apps\\output')
  })
})

describe('appsModelDirs', () => {
  const modelsDirOf = (installPath: string) => `${installPath}/ComfyUI/models`

  it('adds the model folders of builds that do not share models', () => {
    const list = [
      {
        id: 'own',
        installPath: '/i/Own',
        sourceId: 'standalone',
        status: 'installed',
        useSharedModels: false,
        modelDirs: ['/big/models']
      },
      { id: 'shared', installPath: '/i/Shared', sourceId: 'standalone', status: 'installed' },
      {
        id: 'apps',
        installPath: '/i/Apps',
        sourceId: 'standalone',
        appsBuild: true,
        useSharedModels: false
      }
    ]
    expect(appsModelDirs(list, category, modelsDirOf)).toEqual([
      '/i/Own/ComfyUI/models',
      '/big/models'
    ])
  })

  it('leaves out Cloud, legacy Desktop, unfinished builds and repeats', () => {
    const list = [
      { id: 'c', installPath: '', sourceId: 'cloud', useSharedModels: false },
      { id: 'd', installPath: '/i/D', sourceId: 'desktop', useSharedModels: false },
      {
        id: 'f',
        installPath: '/i/F',
        sourceId: 'standalone',
        status: 'failed',
        useSharedModels: false
      },
      {
        id: 'a',
        installPath: '/i/A',
        sourceId: 'git',
        useSharedModels: false,
        modelDirs: ['/m', '/m']
      },
      { id: 'b', installPath: '/i/B', sourceId: 'git', useSharedModels: false, modelDirs: ['/m'] }
    ]
    expect(appsModelDirs(list, category, modelsDirOf)).toEqual([
      '/i/A/ComfyUI/models',
      '/m',
      '/i/B/ComfyUI/models'
    ])
  })
})

describe('pickVariant', () => {
  it('takes the variant Desktop recommends for this machine, else the first', () => {
    const options: Array<{ value: string; recommended?: boolean }> = [
      { value: 'cpu' },
      { value: 'nvidia', recommended: true }
    ]
    expect(pickVariant(options)?.value).toBe('nvidia')
    expect(pickVariant(options.map((o) => ({ ...o, recommended: false })))?.value).toBe('cpu')
    expect(pickVariant([])).toBeNull()
  })
})

describe('downloadBytes', () => {
  it('adds up the bundle files', () => {
    expect(downloadBytes([{ size: 810_000_000 }, { size: 5 }])).toBe(810_000_005)
    expect(downloadBytes([{ size: 'x' }, null])).toBe(0)
    expect(downloadBytes(undefined)).toBe(0)
  })
})

describe('setup progress for the app page', () => {
  it('turns a download percent into bytes when Desktop knows the size', () => {
    expect(setupEvent('download', { percent: 25, status: 'x' }, 800)).toEqual({
      stage: APPS_SETUP_STAGE,
      step: 'Downloading ComfyUI',
      percent: 25,
      state: 'running',
      done: 200,
      total: 800
    })
  })

  it('gives no bytes when the size or percent is unknown', () => {
    expect(setupEvent('download', { percent: 25 }, 0)).not.toHaveProperty('total')
    expect(setupEvent('setup', { percent: -1 }, 800)).toEqual({
      stage: APPS_SETUP_STAGE,
      step: 'Setting up Python',
      percent: -1,
      state: 'running'
    })
  })

  it('passes no install text or paths from Desktop to the page', () => {
    const e = setupEvent('cleanup', { percent: 50, status: '/Users/v/secret', path: '/x' }, 0)
    expect(Object.keys(e!).sort()).toEqual(['percent', 'stage', 'state', 'step'])
  })

  it('skips the step list and the final done message', () => {
    expect(setupEvent('steps', { steps: [] }, 0)).toBeNull()
    expect(setupEvent('done', { percent: 100 }, 0)).toBeNull()
  })

  it('ends with done, failed or cancelled', () => {
    expect(setupEnd('done')).toMatchObject({ state: 'done', percent: 100 })
    expect(setupEnd('failed', 'No disk space')).toMatchObject({
      state: 'failed',
      error: 'No disk space'
    })
    expect(setupEnd('cancelled')).toMatchObject({ state: 'cancelled' })
  })
})

describe('freeing memory after an app run', () => {
  it('frees after a run ends, however it ended', () => {
    for (const type of ['execution_success', 'execution_error', 'execution_interrupted']) {
      expect(isRunEnd(type), type).toBe(true)
    }
    for (const type of ['executing', 'progress', 'status', 'execution_start', 7]) {
      expect(isRunEnd(type), String(type)).toBe(false)
    }
  })

  it('frees only when nothing else waits in the queue', () => {
    expect(queueEmpty({ exec_info: { queue_remaining: 0 } })).toBe(true)
    expect(queueEmpty({ exec_info: { queue_remaining: 2 } })).toBe(false)
    expect(queueEmpty({})).toBe(false)
    expect(queueEmpty(null)).toBe(false)
  })

  it('asks ComfyUI to unload models and free memory', () => {
    expect(JSON.parse(FREE_JSON)).toEqual({ unload_models: true, free_memory: true })
  })

  it('keeps models loaded until the build has been idle for a few minutes', () => {
    const now = 1_000_000_000
    expect(freeWait(now, now)).toBe(FREE_IDLE_MS)
    expect(freeWait(now - 60_000, now)).toBe(FREE_IDLE_MS - 60_000)
    expect(freeWait(now - FREE_IDLE_MS, now)).toBe(0)
    expect(freeWait(now - FREE_IDLE_MS - 1, now)).toBe(0)
  })

  it('waits long enough for the next run to reuse the loaded models, and frees before the build stops', () => {
    expect(FREE_IDLE_MS).toBeGreaterThanOrEqual(2 * 60_000)
    expect(FREE_IDLE_MS).toBeLessThan(APPS_BUILD_IDLE_MS)
  })
})

describe('Apps build launch arguments', () => {
  const big = 48 * 1024 ** 3
  const small = 16 * 1024 ** 3

  it('runs text encoders on the GPU on a Mac with room for them', () => {
    expect(appsLaunchArgs('--enable-manager', '', 'darwin', big)).toBe(
      `--enable-manager ${MAC_GPU_ONLY_ARG}`
    )
    expect(appsLaunchArgs(undefined, '--enable-manager', 'darwin', MAC_GPU_ONLY_MIN_BYTES)).toBe(
      `--enable-manager ${MAC_GPU_ONLY_ARG}`
    )
    expect(appsLaunchArgs('', '--enable-manager', 'darwin', big)).toBe(MAC_GPU_ONLY_ARG)
  })

  it('adds the flag once', () => {
    const once = appsLaunchArgs('--enable-manager', '', 'darwin', big)
    expect(appsLaunchArgs(once, '', 'darwin', big)).toBe(once)
  })

  it('leaves smaller Macs and other systems as they are', () => {
    expect(appsLaunchArgs('--enable-manager', '', 'darwin', small)).toBe('--enable-manager')
    expect(appsLaunchArgs('--enable-manager', '', 'linux', big)).toBe('--enable-manager')
    expect(appsLaunchArgs('--enable-manager', '', 'win32', big)).toBe('--enable-manager')
    expect(appsLaunchArgs(42, '--enable-manager', 'linux', big)).toBe('--enable-manager')
  })
})

describe('stopping the Apps build when idle', () => {
  const now = 1_000_000_000

  it('stops a console Apps build after the idle time', () => {
    expect(
      shouldStopIdle({ mode: 'console', hasWindow: false, lastUse: now - APPS_BUILD_IDLE_MS, now })
    ).toBe(true)
  })

  it('keeps it while it was used recently', () => {
    expect(shouldStopIdle({ mode: 'console', hasWindow: false, lastUse: now - 1000, now })).toBe(
      false
    )
  })

  it('keeps it when the person has it open in a window', () => {
    expect(shouldStopIdle({ mode: 'console', hasWindow: true, lastUse: 0, now })).toBe(false)
    expect(shouldStopIdle({ mode: 'window', hasWindow: false, lastUse: 0, now })).toBe(false)
  })
})

describe('which build Open in ComfyUI picks', () => {
  const list = [
    { id: 'apps', name: 'Apps', sourceId: 'standalone', appsBuild: true, lastLaunchedAt: 99 },
    { id: 'old', name: 'Old', sourceId: 'standalone', status: 'installed', lastLaunchedAt: 1 },
    { id: 'new', name: 'New', sourceId: 'git', lastLaunchedAt: 5 }
  ]
  const own = localInstalls(list, category)

  it('never offers the Apps build as the person own build', () => {
    expect(own.map((i) => i.id)).toEqual(['new', 'old'])
  })

  it('picks the person own build launched last, skipping the Apps build', () => {
    expect(pickOpenTarget(own, new Map())?.id).toBe('new')
  })

  it('prefers one of their builds that is running', () => {
    expect(pickOpenTarget(own, new Map([['old', 10]]))?.id).toBe('old')
    expect(
      pickOpenTarget(
        own,
        new Map([
          ['old', 10],
          ['new', 20]
        ])
      )?.id
    ).toBe('new')
  })

  it('ignores a running Apps build', () => {
    expect(pickOpenTarget(own, new Map([['apps', 50]]))?.id).toBe('new')
  })

  it('opens the build the person picked, only if it is theirs', () => {
    expect(pickOpenTarget(own, new Map(), 'old')?.id).toBe('old')
    expect(pickOpenTarget(own, new Map(), 'apps')).toBeNull()
    expect(pickOpenTarget(own, new Map(), 'gone')).toBeNull()
  })

  it('has nothing to pick when the person has no build of their own', () => {
    expect(pickOpenTarget([], new Map([['apps', 50]]))).toBeNull()
  })
})
