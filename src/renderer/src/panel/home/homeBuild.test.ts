import { describe, expect, it } from 'vitest'
import { deviceKindForChassis } from '../../composables/useLocalDeviceKind'
import { createI18n } from 'vue-i18n'
import { appI18nOptions } from '../../lib/i18nOptions'
import { buildDeviceKind, buildUsageLabel, homeBuildStatus, homeBuildTone } from './homeBuild'
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

describe('buildUsageLabel', () => {
  const NOW = new Date(2026, 10, 20, 15, 0).getTime()
  const t = createI18n(appI18nOptions).global.t
  const used = (sourceCategory: string, lastLaunchedAt?: number): Installation =>
    ({ ...build(sourceCategory), lastLaunchedAt }) as Installation

  it('says No setup needed on a Comfy Cloud that was never opened', () => {
    expect(buildUsageLabel(used('cloud'), NOW, t, 'en')).toBe('No setup needed')
  })

  it('says Never used on a local build that was never opened', () => {
    expect(buildUsageLabel(used('local'), NOW, t, 'en')).toBe('Never used')
  })

  it('says Never used on a remote server that was never opened', () => {
    expect(buildUsageLabel(used('remote'), NOW, t, 'en')).toBe('Never used')
  })

  it('says when an opened Comfy Cloud was last used', () => {
    expect(buildUsageLabel(used('cloud', NOW - 2 * 60 * 60_000), NOW, t, 'en')).toBe('Used 2h ago')
  })
})
