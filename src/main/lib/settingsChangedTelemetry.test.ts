import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./telemetry', () => ({ capture: vi.fn() }))

import * as telemetry from './telemetry'
import { captureSettingChanged } from './settingsChangedTelemetry'

const capture = vi.mocked(telemetry.capture)

describe('captureSettingChanged', () => {
  beforeEach(() => capture.mockClear())

  it('sends the key and new boolean for a global toggle', () => {
    captureSettingChanged('autoUpdate', true, false)

    expect(capture).toHaveBeenCalledWith('comfy.desktop.settings.changed', {
      scope: 'global',
      installation_id: undefined,
      setting_key: 'autoUpdate',
      bool_value: false
    })
  })

  it('names the installation for a per-install change', () => {
    captureSettingChanged('useSharedInput', undefined, false, 'inst-1')

    expect(capture).toHaveBeenCalledWith('comfy.desktop.settings.changed', {
      scope: 'install',
      installation_id: 'inst-1',
      setting_key: 'useSharedInput',
      bool_value: false
    })
  })

  it('never sends a non-boolean value', () => {
    captureSettingChanged('inputDir', '/home/alice/in', '/home/alice/private-out', 'inst-1')
    captureSettingChanged('modelsDirs', ['/a'], ['/a', '/b'])

    expect(capture).toHaveBeenCalledTimes(2)
    for (const [, props] of capture.mock.calls) {
      expect(props?.['bool_value']).toBeUndefined()
      expect(JSON.stringify(props)).not.toContain('/')
    }
  })

  it('is silent when the value did not change', () => {
    captureSettingChanged('autoUpdate', true, true)
    captureSettingChanged('modelsDirs', ['/a', '/b'], ['/a', '/b'], 'inst-1')

    expect(capture).not.toHaveBeenCalled()
  })
})
