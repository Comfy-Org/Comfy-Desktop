import { beforeEach, describe, expect, it, vi } from 'vitest'

// Configurable ctx + source category returned by the mocked `./shared` module.
let mockCtx: Record<string, unknown> | null = null
let mockSourceCategory: string | null = 'local'

vi.mock('./shared', () => ({
  buildInstallationDdContext: vi.fn(async () => mockCtx),
  // `emitInstanceStartedTelemetry` looks up `sourceMap[ctx.source_id]?.category`.
  sourceMap: new Proxy(
    {},
    {
      get: () => ({ category: mockSourceCategory })
    }
  )
}))

vi.mock('../../settings', () => ({
  getTrackedSettingsTelemetryProperties: vi.fn(() => ({}))
}))

vi.mock('../telemetry', () => ({
  capture: vi.fn(),
  registerPersonPropertiesOnce: vi.fn(),
  asDeployment: (value: unknown) =>
    value === 'local' || value === 'cloud' || value === 'remote' ? value : null
}))

import { emitInstanceStartedTelemetry } from './sessionStartTelemetry'
import * as telemetry from '../telemetry'

function baseCtx(sourceId: string): Record<string, unknown> {
  return {
    source_id: sourceId,
    snapshot_diffs: [],
    latest_snapshot: null,
    installation_id: 'inst-1'
  }
}

const info = { installationId: 'inst-1', portRetries: 0, rebootRetries: 0 }

describe('emitInstanceStartedTelemetry — first_local_instance_started_at guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stamps the durable person marker for LOCAL sources', async () => {
    mockCtx = baseCtx('local-src')
    mockSourceCategory = 'local'

    await emitInstanceStartedTelemetry(info)

    expect(telemetry.registerPersonPropertiesOnce).toHaveBeenCalledWith(
      expect.objectContaining({ first_local_instance_started_at: expect.any(String) })
    )
  })

  it.each(['cloud', 'remote', null])(
    'does NOT stamp the person marker for %s sources',
    async (category) => {
      mockCtx = baseCtx('non-local-src')
      mockSourceCategory = category

      await emitInstanceStartedTelemetry(info)

      expect(telemetry.registerPersonPropertiesOnce).not.toHaveBeenCalled()
      // The per-boot events still fire regardless of source category.
      expect(telemetry.capture).toHaveBeenCalledWith(
        'comfy.desktop.session.instance_started',
        expect.anything()
      )
    }
  )
})
