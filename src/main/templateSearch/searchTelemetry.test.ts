import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capture } from '../lib/telemetry'
import { reportBundleDownload, reportStartAttempt } from './searchTelemetry'

vi.mock('../lib/telemetry', () => ({ capture: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('search telemetry from the main process', () => {
  it('sends a start attempt as process_started', () => {
    reportStartAttempt({
      result: 'bundle_invalid',
      startMs: 812,
      bundleVersion: '2.3.0',
      verified: true
    })
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      'comfy.desktop.template_search.process_started',
      { result: 'bundle_invalid', start_ms: 812, bundle_version: '2.3.0', is_verified: true }
    )
  })

  it('sends a model download as bundle_downloaded', () => {
    reportBundleDownload({
      result: 'completed',
      bytes: 312_000_000,
      durationMs: 41_000,
      trigger: 'launch',
      version: '2.3.0'
    })
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      'comfy.desktop.template_search.bundle_downloaded',
      {
        result: 'completed',
        size_bytes: 312_000_000,
        duration_ms: 41_000,
        trigger: 'launch',
        bundle_version: '2.3.0'
      }
    )
  })

  it('never lets a telemetry failure reach a start or a download', () => {
    vi.mocked(capture).mockImplementation(() => {
      throw new Error('telemetry is down')
    })
    expect(() =>
      reportStartAttempt({ result: 'ready', startMs: 1, bundleVersion: '2.3.0', verified: false })
    ).not.toThrow()
    expect(() =>
      reportBundleDownload({
        result: 'completed',
        bytes: 1,
        durationMs: 1,
        trigger: 'retry',
        version: '2.3.0'
      })
    ).not.toThrow()
  })
})
