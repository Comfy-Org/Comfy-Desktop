import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capture } from '../lib/telemetry'
import { reportBundleDownload, reportStartAttempt, reportTemplateSent } from './searchTelemetry'

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
      background: true,
      version: '2.3.0'
    })
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      'comfy.desktop.template_search.bundle_downloaded',
      {
        result: 'completed',
        size_bytes: 312_000_000,
        duration_ms: 41_000,
        is_background_update: true,
        bundle_version: '2.3.0'
      }
    )
  })

  it('sends a template given to a starting build as template_sent_to_build', () => {
    reportTemplateSent({ searchId: null, templateId: 'poster_template', pickToSendMs: 9000 })
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      'comfy.desktop.template_search.template_sent_to_build',
      { search_id: null, template_id: 'poster_template', pick_to_send_ms: 9000 }
    )
  })

  it('never lets a telemetry failure reach a start, a download or a launch', () => {
    vi.mocked(capture).mockImplementation(() => {
      throw new Error('telemetry is down')
    })
    expect(() =>
      reportStartAttempt({ result: 'ready', startMs: 1, bundleVersion: '2.3.0', verified: false })
    ).not.toThrow()
    expect(() =>
      reportTemplateSent({ searchId: null, templateId: 'poster_template', pickToSendMs: 1 })
    ).not.toThrow()
  })
})
