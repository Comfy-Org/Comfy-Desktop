import { describe, expect, it } from 'vitest'
import { buildDeviceKind } from './homeBuild'
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
