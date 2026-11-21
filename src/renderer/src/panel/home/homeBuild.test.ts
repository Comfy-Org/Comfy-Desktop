import { describe, expect, it } from 'vitest'
import { deviceKindForChassis } from '../../composables/useLocalDeviceKind'
import { buildDeviceKind, homeBuildStatus, homeBuildTone, runsOnThisComputer } from './homeBuild'
import type { Installation } from '../../types/ipc'

const build = (sourceCategory: string): Installation =>
  ({ id: 'b', name: 'Build', sourceCategory }) as unknown as Installation

describe('buildDeviceKind', () => {
  it.each([
    ['win32', 'Desktop', 'monitor'],
    ['win32', 'Tower', 'monitor'],
    ['win32', 'Notebook', 'pc-laptop'],
    ['win32', 'Convertible', 'pc-laptop'],
    ['darwin', 'Notebook', 'laptop'],
    ['darwin', 'Desktop', 'monitor'],
    ['linux', 'Laptop', 'pc-laptop'],
    ['linux', 'Mini PC', 'monitor'],
    ['win32', 'Unknown', 'monitor'],
    ['darwin', null, 'monitor']
  ] as const)('draws a local build on %s with chassis %s as %s', (platform, chassis, expected) => {
    const localKind = deviceKindForChassis(platform, chassis)
    expect(buildDeviceKind(build('local'), localKind)).toBe(expected)
  })

  it.each(['laptop', 'pc-laptop', 'monitor'] as const)(
    'draws a cloud build as the cloud on %s',
    (localKind) => {
      expect(buildDeviceKind(build('cloud'), localKind)).toBe('cloud')
    }
  )

  it('uses a generic display for a remote server reached from a laptop', () => {
    expect(buildDeviceKind(build('remote'), 'pc-laptop')).toBe('monitor')
  })
})

describe('homeBuildTone', () => {
  it.each(['local', 'remote'] as const)('gives every %s build the same purple tone', (category) => {
    expect(homeBuildTone(build(category))).toBe('iris')
  })

  it('gives a cloud build its own tone', () => {
    expect(homeBuildTone(build('cloud'))).toBe('tide')
  })
})

describe('homeBuildStatus', () => {
  const session = (running: string[] = []) => ({
    isRunning: (id: string) => running.includes(id),
    isLaunching: () => false,
    isStopping: () => false,
    operationInstances: new Map()
  })

  it('reads Running for a build whose ComfyUI runs in the background with no window', () => {
    expect(homeBuildStatus(build('local'), session(['b']))).toBe('running')
  })

  it('gives Comfy Cloud no Always on, since it has no process on this computer', () => {
    expect(homeBuildStatus(build('cloud'), session())).toBe('ready')
  })
})

describe('runsOnThisComputer', () => {
  it('is true for a running local build', () => {
    expect(runsOnThisComputer(build('local'), 'running')).toBe(true)
  })

  it('is false for an opened Comfy Cloud, which runs no process here', () => {
    expect(runsOnThisComputer(build('cloud'), 'running')).toBe(false)
  })

  it('is false for an opened remote server, which runs no process here', () => {
    expect(runsOnThisComputer(build('remote'), 'running')).toBe(false)
  })

  it('is false for a local build at rest', () => {
    expect(runsOnThisComputer(build('local'), 'ready')).toBe(false)
  })
})
