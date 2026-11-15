import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  records: [] as Record<string, unknown>[],
  sessions: new Map<string, Record<string, unknown>>(),
  launching: new Set<string>(),
  operations: new Map<string, unknown>(),
  versionFiles: new Map<string, string>()
}))

vi.mock('fs', () => ({
  promises: {
    readFile: async (file: string) => {
      const text = mocks.versionFiles.get(file)
      if (text === undefined) throw new Error('ENOENT')
      return text
    }
  }
}))
vi.mock('../installations', () => ({ list: async () => mocks.records }))
vi.mock('../lib/ipc/shared', () => ({
  _hasActiveLaunch: (id: string) => mocks.launching.has(id),
  _operationAborts: mocks.operations,
  _runningSessions: mocks.sessions,
  sourceMap: {
    standalone: { category: 'local' },
    portable: { category: 'local' },
    desktop: { category: 'local' },
    cloud: { category: 'cloud' },
    remote: { category: 'remote' }
  }
}))
vi.mock('../lib/models', () => ({
  resolveComfyDir: (installPath: string) => `${installPath}/ComfyUI`
}))

import { chooseLocalBuild, runningPortOf, usableLocalBuilds, wantedVersion } from './localBuild'
import type { LocalBuild } from './localBuild'

function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'studio',
    name: 'Studio',
    sourceId: 'standalone',
    installPath: '/builds/studio',
    status: 'installed',
    version: 'v0.42.1',
    lastLaunchedAt: 100,
    ...over
  }
}

function build(over: Partial<LocalBuild> = {}): LocalBuild {
  return {
    id: 'studio',
    name: 'Studio',
    version: '0.42.1',
    port: null,
    starting: false,
    lastLaunchedAt: 0,
    ...over
  }
}

beforeEach(() => {
  mocks.records = []
  mocks.sessions.clear()
  mocks.launching.clear()
  mocks.operations.clear()
  mocks.versionFiles.clear()
})

describe('the ComfyUI version a page asks for', () => {
  it.each([
    [{ minVersion: '0.41.0' }, '0.41.0'],
    [{ minVersion: 'v0.37.0' }, '0.37.0'],
    [{ minVersion: '0.21' }, '0.21.0'],
    [{ minVersion: '' }, null],
    [{ minVersion: 41 }, null],
    [{}, null],
    [undefined, null],
    ['0.41.0', null]
  ])('reads %j as %j', (want, version) => {
    expect(wantedVersion(want)).toBe(version)
  })
})

describe('the builds on this computer an app can run on', () => {
  it('are the installed local builds, each with its version and whether it is running', async () => {
    mocks.records = [record(), record({ id: 'lab', name: 'Lab', installPath: '/builds/lab' })]
    mocks.sessions.set('lab', { port: 8190 })

    expect(await usableLocalBuilds()).toEqual([
      build({ lastLaunchedAt: 100 }),
      build({ id: 'lab', name: 'Lab', port: 8190, lastLaunchedAt: 100 })
    ])
  })

  it('leave out Comfy Cloud, remote servers, the legacy app and unfinished installs', async () => {
    mocks.records = [
      record({ id: 'cloud', sourceId: 'cloud' }),
      record({ id: 'remote', sourceId: 'remote' }),
      record({ id: 'legacy', sourceId: 'desktop' }),
      record({ id: 'unknown-kind', sourceId: 'mystery' }),
      record({ id: 'installing', status: 'installing' }),
      record({ id: 'updating', status: 'updating' }),
      record({ id: 'nowhere', installPath: '' })
    ]

    expect(await usableLocalBuilds()).toEqual([])
  })

  it('leave out a build that is being updated or copied, but keep one that is starting', async () => {
    mocks.records = [record({ id: 'updating-now' }), record({ id: 'starting-now' })]
    mocks.operations.set('updating-now', {})
    mocks.operations.set('starting-now', {})
    mocks.launching.add('starting-now')

    expect((await usableLocalBuilds()).map(({ id, starting }) => ({ id, starting }))).toEqual([
      { id: 'starting-now', starting: true }
    ])
  })

  it('read the version from the ComfyUI on disk before the one recorded at install', async () => {
    mocks.records = [record({ version: 'v0.30.0' })]
    mocks.versionFiles.set(
      '/builds/studio/ComfyUI/comfyui_version.py',
      '# generated\n__version__ = "0.42.1"\n'
    )

    expect((await usableLocalBuilds())[0]?.version).toBe('0.42.1')
  })

  it('have no version when neither the disk nor the record gives one', async () => {
    mocks.records = [record({ version: undefined })]

    expect((await usableLocalBuilds())[0]?.version).toBeNull()
  })
})

describe('a running build', () => {
  it('is one with a port on this computer', () => {
    mocks.sessions.set('studio', { port: 8188 })

    expect(runningPortOf('studio')).toBe(8188)
    expect(runningPortOf('lab')).toBeNull()
  })

  it('is not a remote session, one with no port yet, or another session of the same build', () => {
    mocks.sessions.set('remote', { port: 443, url: 'https://comfy.example' })
    mocks.sessions.set('external', { port: 0 })
    mocks.sessions.set('performance-test:studio', { port: 8200, sourceInstallationId: 'studio' })

    expect(runningPortOf('remote')).toBeNull()
    expect(runningPortOf('external')).toBeNull()
    expect(runningPortOf('performance-test:studio')).toBeNull()
  })
})

describe('choosing the build for a run', () => {
  it('says there are no builds', () => {
    expect(chooseLocalBuild([], '0.41.0')).toEqual({ kind: 'no-builds' })
  })

  it('says every build is too old, or of unknown age, for the page', () => {
    const builds = [build({ version: '0.37.0' }), build({ id: 'lab', version: null })]

    expect(chooseLocalBuild(builds, '0.41.0')).toEqual({ kind: 'too-old', wanted: '0.41.0' })
  })

  it('takes any build when the page names no version', () => {
    expect(chooseLocalBuild([build({ version: null })], null)).toMatchObject({ kind: 'build' })
  })

  it('prefers the build that is already running', () => {
    const builds = [
      build({ id: 'newest', version: '0.45.0', lastLaunchedAt: 900 }),
      build({ id: 'running', version: '0.41.0', port: 8188, lastLaunchedAt: 1 })
    ]

    expect(chooseLocalBuild(builds, '0.41.0')).toMatchObject({ build: { id: 'running' } })
  })

  it('then the one that is starting, then the one used last, then the newest', () => {
    const starting = build({ id: 'starting', starting: true })
    const usedLast = build({ id: 'used-last', lastLaunchedAt: 500 })
    const newest = build({ id: 'newest', version: '0.45.0' })
    const older = build({ id: 'older', version: '0.41.0' })

    expect(chooseLocalBuild([older, usedLast, starting], null)).toMatchObject({
      build: { id: 'starting' }
    })
    expect(chooseLocalBuild([older, newest, usedLast], null)).toMatchObject({
      build: { id: 'used-last' }
    })
    expect(chooseLocalBuild([older, newest], null)).toMatchObject({ build: { id: 'newest' } })
  })

  it('never takes a running build that is too old over a stopped one that fits', () => {
    const builds = [
      build({ id: 'old-running', version: '0.30.0', port: 8188 }),
      build({ id: 'fits', version: '0.42.0' })
    ]

    expect(chooseLocalBuild(builds, '0.41.0')).toMatchObject({ build: { id: 'fits' } })
  })
})
