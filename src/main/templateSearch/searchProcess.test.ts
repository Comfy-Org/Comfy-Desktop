import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  operationAborts: new Map<string, AbortController>(),
  activeLaunches: new Set<string>(),
  activeOperations: vi.fn((): { installationId: string; actionId: string }[] => []),
  buildRuntime: vi.fn(),
  settings: {} as Record<string, unknown>
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/userdata' }, net: {} }))
vi.mock('../lib/ipc/shared', () => ({
  _operationAborts: mocks.operationAborts,
  _hasActiveLaunch: (id: string) => mocks.activeLaunches.has(id)
}))
vi.mock('../lib/ipc/sessionActions', () => ({ _getActiveOperations: mocks.activeOperations }))
vi.mock('./buildRuntime', () => ({ buildRuntime: mocks.buildRuntime }))
vi.mock('../settings', () => ({ get: (key: string) => mocks.settings[key] }))

import type { InstallationRecord } from '../installations'
import {
  changesBuildEnv,
  isBuildBusy,
  parseSupports,
  rememberOnceFound,
  SIDECAR_PATH_ENV,
  sidecarPythons,
  templateSearchOn,
  templateSearchPartnersOn,
  zipappPath
} from './searchProcess'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.operationAborts.clear()
  mocks.activeLaunches.clear()
  mocks.activeOperations.mockReturnValue([])
  mocks.buildRuntime.mockImplementation((build: InstallationRecord) =>
    build.id === 'no-python' ? null : { python: `/py/${build.id}`, sitePackages: null }
  )
})

function build(id: string, over: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    id,
    name: id,
    sourceId: 'standalone',
    installPath: `/i/${id}`,
    ...over
  } as InstallationRecord
}

describe('templateSearchOn', () => {
  it.each([
    [true, '/opt/search.pyz', true],
    [true, undefined, false],
    [true, '  ', false],
    [false, '/opt/search.pyz', false]
  ])('with the setting %s and the search program at %j is %s', (enabled, configured, on) => {
    mocks.settings = { templateSearchEnabled: enabled }
    if (configured === undefined) delete process.env[SIDECAR_PATH_ENV]
    else process.env[SIDECAR_PATH_ENV] = configured
    try {
      expect(templateSearchOn()).toBe(on)
    } finally {
      delete process.env[SIDECAR_PATH_ENV]
    }
  })
})

describe('templateSearchPartnersOn', () => {
  it.each([
    [undefined, true],
    [true, true],
    [false, false]
  ])('with the partner setting %s shows partner templates: %s', (value, shown) => {
    mocks.settings = { templateSearchPartners: value }
    expect(templateSearchPartnersOn()).toBe(shown)
  })
})

describe('zipappPath', () => {
  it('runs search only when the setting is exactly on and a zipapp is configured', () => {
    expect(zipappPath(true, ' /opt/search.pyz ')).toBe('/opt/search.pyz')
    expect(zipappPath(true, '  ')).toBeNull()
    expect(zipappPath(true, undefined)).toBeNull()
    expect(zipappPath(undefined, '/opt/search.pyz')).toBeNull()
    expect(zipappPath('true', '/opt/search.pyz')).toBeNull()
    expect(zipappPath(false, '/opt/search.pyz')).toBeNull()
  })
})

describe('sidecarPythons', () => {
  it('offers local builds with a Python, most recently launched first', () => {
    const builds = [
      build('old', { lastLaunchedAt: 100 }),
      build('cloud', { lastLaunchedAt: 900, sourceId: 'cloud' }),
      build('recent', { lastLaunchedAt: 500 }),
      build('never'),
      build('no-python', { lastLaunchedAt: 700 })
    ]
    const pythons = sidecarPythons(
      builds,
      (b) => b.sourceId !== 'cloud',
      () => null
    )
    expect(pythons).toEqual([
      { installationId: 'recent', python: '/py/recent' },
      { installationId: 'old', python: '/py/old' },
      { installationId: 'never', python: '/py/never' }
    ])
  })

  it("asks each build's source where its Python lives", () => {
    const env = { venvDir: '/i/git/venv' }
    sidecarPythons(
      [build('git')],
      () => true,
      () => env
    )
    expect(mocks.buildRuntime).toHaveBeenCalledWith(expect.objectContaining({ id: 'git' }), env)
  })
})

describe('isBuildBusy and changesBuildEnv', () => {
  it.each(['launch', 'delete', 'copy-update', 'update-comfyui'])(
    'counts %s as changing the build environment',
    (actionId) => {
      expect(changesBuildEnv(actionId)).toBe(true)
      mocks.activeOperations.mockReturnValue([{ installationId: 'a', actionId }])
      expect(isBuildBusy('a')).toBe(true)
      expect(isBuildBusy('b')).toBe(false)
    }
  )

  it.each(['rename', 'open-folder', 'check-update'])('does not count %s', (actionId) => {
    expect(changesBuildEnv(actionId)).toBe(false)
    mocks.activeOperations.mockReturnValue([{ installationId: 'a', actionId }])
    expect(isBuildBusy('a')).toBe(false)
  })

  it('counts a build that is still installing', () => {
    mocks.operationAborts.set('a', new AbortController())
    expect(isBuildBusy('a')).toBe(true)
  })

  it('counts a build launching outside a session action, as Apps launches it', () => {
    mocks.activeLaunches.add('a')
    expect(isBuildBusy('a')).toBe(true)
    expect(isBuildBusy('b')).toBe(false)
  })
})

describe('rememberOnceFound', () => {
  it('asks again after an answer of nothing, and keeps the first real answer', async () => {
    const find = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('found')
    const cached = rememberOnceFound(find)
    expect(await cached()).toBeNull()
    expect(await cached()).toBe('found')
    expect(await cached()).toBe('found')
    expect(find).toHaveBeenCalledTimes(2)
  })
})

describe('parseSupports', () => {
  const line = JSON.stringify({
    event: 'supports',
    sidecar: '0.1.0',
    protocol: 1,
    accepts: { major: 1, min_minor: 0 }
  })

  it('reads the sidecar version and the bundle versions it accepts from its last line', () => {
    expect(parseSupports(`a warning\n${line}\n`)).toEqual({
      sidecar: '0.1.0',
      major: 1,
      minMinor: 0
    })
  })

  it.each(['', 'not json', JSON.stringify({ sidecar: '0.1.0' })])('refuses %j', (stdout) => {
    expect(parseSupports(stdout)).toBeNull()
  })
})
