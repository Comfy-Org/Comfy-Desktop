import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capture } from '../lib/telemetry'
import { reportBundleDownload, reportStartAttempt, reportTemplateLoaded } from './searchTelemetry'

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

  it('sends a template handed to a build as template_loaded', () => {
    reportTemplateLoaded({
      searchId: null,
      templateId: 'poster_template',
      buildStarted: true,
      pickToLoadMs: 9000
    })
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      'comfy.desktop.template_search.template_loaded',
      {
        search_id: null,
        template_id: 'poster_template',
        build_started: true,
        pick_to_load_ms: 9000
      }
    )
  })
})
