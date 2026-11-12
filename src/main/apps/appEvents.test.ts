import { beforeEach, describe, expect, it, vi } from 'vitest'

const telemetry = vi.hoisted(() => ({ capture: vi.fn(), emit: vi.fn() }))
vi.mock('../lib/telemetry', () => telemetry)

const appsSwitch = vi.hoisted(() => ({ isAppsEnabled: vi.fn(() => true) }))
vi.mock('./appsSwitch', () => appsSwitch)

import { trackApps, trackFromPage } from './appEvents'

function sent(): Array<[string, Record<string, unknown>]> {
  return [...telemetry.capture.mock.calls, ...telemetry.emit.mock.calls] as Array<
    [string, Record<string, unknown>]
  >
}

beforeEach(() => {
  telemetry.capture.mockReset()
  telemetry.emit.mockReset()
  appsSwitch.isAppsEnabled.mockReturnValue(true)
})

describe('trackFromPage', () => {
  it.each<[string, Record<string, unknown>]>([
    ['app_opened', { app: 'remove-background' }],
    [
      'run_started',
      { app: 'text-to-image', where: 'cloud', model: 'flux-2', quality: 'best', seconds: 5 }
    ],
    ['run_started', { app: 'text-to-image', where: 'local' }],
    ['example_used', { app: 'image-edit', example: 'cat-in-hat' }],
    ['open_in_comfyui', { app: 'upscale', where: 'local' }]
  ])('sends %s as comfy.desktop.apps.%s with the switch state', (name, fields) => {
    trackFromPage(name, fields)

    expect(telemetry.capture).toHaveBeenCalledExactlyOnceWith(`comfy.desktop.apps.${name}`, {
      ...fields,
      apps_enabled: true
    })
    expect(telemetry.emit).not.toHaveBeenCalled()
  })

  it('says when the Apps switch is off', () => {
    appsSwitch.isAppsEnabled.mockReturnValue(false)
    trackFromPage('app_opened', { app: 'upscale' })

    expect(telemetry.capture).toHaveBeenCalledWith('comfy.desktop.apps.app_opened', {
      app: 'upscale',
      apps_enabled: false
    })
  })

  it('drops fields that are not on the list and keeps the event', () => {
    trackFromPage('run_started', {
      app: 'upscale',
      where: 'cloud',
      prompt: 'a cat in a hat',
      file: '/Users/someone/cat.png'
    })

    expect(sent()).toEqual([
      ['comfy.desktop.apps.run_started', { app: 'upscale', where: 'cloud', apps_enabled: true }]
    ])
  })

  it('reads a null optional field as missing', () => {
    trackFromPage('run_started', { app: 'upscale', where: 'cloud', model: null })

    expect(sent()).toEqual([
      ['comfy.desktop.apps.run_started', { app: 'upscale', where: 'cloud', apps_enabled: true }]
    ])
  })

  it('rounds seconds to a tenth', () => {
    trackFromPage('run_started', { app: 'upscale', where: 'local', seconds: 12.345 })

    expect(sent()[0]![1]['seconds']).toBe(12.3)
  })

  it.each<[string, unknown, unknown]>([
    ['an unknown event', 'page_viewed', { app: 'upscale' }],
    ['an event only Desktop sends', 'run_failed', { app: 'upscale', where: 'cloud', step: 'run' }],
    ['an event only Desktop sends', 'output_saved', { app: 'upscale', where: 'cloud' }],
    ['a name that is not a string', 42, { app: 'upscale' }],
    ['a name from the object prototype', 'constructor', {}],
    ['fields that are a list', 'app_opened', ['upscale']],
    ['fields that are text', 'app_opened', 'upscale'],
    ['no fields', 'app_opened', undefined],
    ['a missing app', 'run_started', { where: 'cloud' }],
    ['a missing where', 'run_started', { app: 'upscale' }],
    ['an app with capitals', 'app_opened', { app: 'Upscale' }],
    ['an app that is a display name', 'app_opened', { app: 'Remove background' }],
    ['an app that is a path', 'app_opened', { app: '/Users/someone/apps' }],
    ['an app that is a Windows path', 'app_opened', { app: 'C:\\apps' }],
    ['an app of 65 characters', 'app_opened', { app: 'a'.repeat(65) }],
    ['an app that starts with a dash', 'app_opened', { app: '-upscale' }],
    ['an app that is a number', 'app_opened', { app: 7 }],
    ['an example that is free text', 'example_used', { app: 'upscale', example: 'my dog, rex' }],
    ['a where that is not cloud or local', 'open_in_comfyui', { app: 'upscale', where: 'mars' }],
    ['a quality that is not fast or best', 'run_started', { ...run(), quality: 'ultra' }],
    ['a model with a slash', 'run_started', { ...run(), model: 'org/model' }],
    ['a model of 65 characters', 'run_started', { ...run(), model: 'm'.repeat(65) }],
    ['negative seconds', 'run_started', { ...run(), seconds: -1 }],
    ['seconds as text', 'run_started', { ...run(), seconds: '5' }],
    ['seconds that are not a number', 'run_started', { ...run(), seconds: Number.NaN }],
    ['endless seconds', 'run_started', { ...run(), seconds: Number.POSITIVE_INFINITY }],
    ['an object for a field', 'run_started', { ...run(), model: { id: 'flux' } }]
  ])('drops %s', (_why, name, fields) => {
    trackFromPage(name, fields)

    expect(sent()).toEqual([])
  })

  it('never throws to the page and returns nothing', () => {
    telemetry.capture.mockImplementation(() => {
      throw new Error('posthog down')
    })
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        }
      }
    )

    expect(trackFromPage('app_opened', { app: 'upscale' })).toBeUndefined()
    expect(() => trackFromPage('app_opened', hostile)).not.toThrow()
  })
})

function run(): Record<string, unknown> {
  return { app: 'upscale', where: 'cloud' }
}

const finished = {
  app: 'upscale',
  where: 'local' as const,
  outcome: 'success' as const,
  run_seconds: 41.27,
  queue_seconds: 2,
  comfy: 'apps_build' as const,
  comfy_version: '0.3.68',
  gpu: 'nvidia' as const,
  vram_gb: 11.8,
  ram_gb: 31.6,
  os: 'win32' as const
}

describe('trackApps', () => {
  it('sends run_failed to PostHog and Datadog', () => {
    trackApps('run_failed', {
      app: 'upscale',
      where: 'cloud',
      step: 'rejected',
      error_class: 'http_400',
      node_types: ['KSampler', 'Image Remove Background (rembg)']
    })

    expect(telemetry.emit).toHaveBeenCalledExactlyOnceWith('comfy.desktop.apps.run_failed', {
      app: 'upscale',
      where: 'cloud',
      step: 'rejected',
      error_class: 'http_400',
      node_types: ['KSampler', 'Image Remove Background (rembg)'],
      apps_enabled: true
    })
    expect(telemetry.capture).not.toHaveBeenCalled()
  })

  it('sends run_finished with VRAM and RAM in whole GB', () => {
    trackApps('run_finished', finished)

    expect(telemetry.capture).toHaveBeenCalledExactlyOnceWith('comfy.desktop.apps.run_finished', {
      ...finished,
      run_seconds: 41.3,
      vram_gb: 12,
      ram_gb: 32,
      apps_enabled: true
    })
  })

  it('sends output_saved and the page events', () => {
    trackApps('output_saved', { app: 'upscale', where: 'local' })
    trackApps('app_opened', { app: 'upscale' })

    expect(sent().map(([name]) => name)).toEqual([
      'comfy.desktop.apps.output_saved',
      'comfy.desktop.apps.app_opened'
    ])
  })

  it.each<[string, Parameters<typeof trackApps<'setup'>>[1]]>([
    ['a started ComfyUI setup', { stage: 'comfyui', outcome: 'started', bytes: 2_500_000_000 }],
    ['a finished setup with its time', { stage: 'comfyui', outcome: 'finished', seconds: 300 }],
    [
      'a model download with its public file name',
      { app: 'upscale', stage: 'model', outcome: 'finished', model_file: '4x-UltraSharp.pth' }
    ]
  ])('sends setup for %s', (_why, fields) => {
    trackApps('setup', fields)

    expect(telemetry.capture).toHaveBeenCalledWith('comfy.desktop.apps.setup', {
      ...fields,
      apps_enabled: true
    })
  })

  it.each<[string, Parameters<typeof trackApps>]>([
    ['a step that is not on the list', ['run_failed', { ...failed(), step: 'other' as 'run' }]],
    ['an error class with a message', ['run_failed', { ...failed(), error_class: 'Out of VRAM' }]],
    [
      'an error class with a module path',
      ['run_failed', { ...failed(), error_class: 'torch.OutOfMemoryError' }]
    ],
    ['more than 20 node types', ['run_failed', { ...failed(), node_types: many(21) }]],
    ['no node types in the list', ['run_failed', { ...failed(), node_types: [] }]],
    ['a node type that is a path', ['run_failed', { ...failed(), node_types: ['a/b'] }]],
    ['an outcome not on the list', ['run_finished', { ...finished, outcome: 'ok' as 'success' }]],
    ['a missing run time', ['run_finished', { ...finished, run_seconds: undefined as never }]],
    ['an OS not on the list', ['run_finished', { ...finished, os: 'aix' }]],
    ['a GPU not on the list', ['run_finished', { ...finished, gpu: 'mps' as 'apple' }]],
    ['a ComfyUI version with a path', ['run_finished', { ...finished, comfy_version: '../x' }]],
    [
      'a model file that is a path',
      ['setup', { stage: 'model', outcome: 'started', model_file: '/models/a.safetensors' }]
    ],
    [
      'a model file that is not a model',
      ['setup', { stage: 'model', outcome: 'started', model_file: 'notes.txt' }]
    ],
    ['a setup stage not on the list', ['setup', { stage: 'pip' as 'model', outcome: 'started' }]],
    ['negative bytes', ['setup', { stage: 'model', outcome: 'failed', bytes: -5 }]]
  ])('drops %s', (_why, [name, fields]) => {
    trackApps(name, fields)

    expect(sent()).toEqual([])
  })

  it('never throws when telemetry does', () => {
    telemetry.emit.mockImplementation(() => {
      throw new Error('posthog down')
    })

    expect(() => trackApps('run_failed', failed())).not.toThrow()
  })
})

function failed(): Parameters<typeof trackApps<'run_failed'>>[1] {
  return { app: 'upscale', where: 'cloud', step: 'run' }
}

function many(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Node${i}`)
}
