import { describe, expect, it } from 'vitest'
import { buildDeviceKind, homeBuildTones } from './homeBuild'
import type { Installation } from '../../types/ipc'

const build = (sourceCategory: string): Installation =>
  ({ id: 'b', name: 'Build', sourceCategory }) as unknown as Installation

describe('buildDeviceKind', () => {
  it('draws a local build as the computer this platform usually runs on', () => {
    expect(buildDeviceKind(build('local'), 'darwin')).toBe('laptop')
    expect(buildDeviceKind(build('local'), 'win32')).toBe('pc-laptop')
    expect(buildDeviceKind(build('local'), 'linux')).toBe('monitor')
  })

  it('draws a cloud build as the cloud on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(buildDeviceKind(build('cloud'), platform)).toBe('cloud')
    }
  })

  it('falls back to the laptop when the platform is unknown', () => {
    expect(buildDeviceKind(build('local'), undefined)).toBe('laptop')
  })
})

describe('homeBuildTones', () => {
  const local = (id: string, createdAt: string): Installation =>
    ({ id, name: id, sourceCategory: 'local', createdAt }) as unknown as Installation
  const first = local('first', '2026-01-01T00:00:00Z')
  const second = local('second', '2026-02-01T00:00:00Z')
  const third = local('third', '2026-03-01T00:00:00Z')
  const cloud = { id: 'cloud', name: 'Cloud', sourceCategory: 'cloud' } as unknown as Installation

  it('gives each local build the color of its install order, whatever the list order', () => {
    expect(homeBuildTones([third, cloud, first, second])).toEqual([
      'ember',
      'tide',
      'ember',
      'iris'
    ])
    expect(homeBuildTones([second, first, third])).toEqual(['iris', 'ember', 'ember'])
  })

  it('keeps a build its color when the list shows only some builds', () => {
    const everyBuild = [first, second, third, cloud]

    expect(homeBuildTones([second], everyBuild)).toEqual(['iris'])
    expect(homeBuildTones([third, second], everyBuild)).toEqual(['ember', 'iris'])
  })
})
