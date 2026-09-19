import { describe, expect, it } from 'vitest'

import {
  isDatadogMirroredEvent,
  stripDatadogDroppedKeys,
  DATADOG_DROPPED_CONTEXT_KEYS
} from './datadogMirroredEvents'

describe('isDatadogMirroredEvent', () => {
  // The boot lifecycle splits success vs failure: boot_failed is a failure
  // signal ops alerts on, boot_started/boot_completed are funnel events
  // (PostHog only). Mirroring a success event would page on-call on healthy
  // boots and double its RUM volume for no monitor benefit.
  it('mirrors boot_failed but not boot_started / boot_completed', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_failed')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.asset_scan_error')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_started')).toBe(false)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_completed')).toBe(false)
  })

  // The onboarding→install handoff (#1224) splits the same way: install.not_started
  // is the abort/failure signal ops alerts on; install.dispatched is the paired
  // funnel success gate (PostHog only).
  it('mirrors install.not_started but not install.dispatched', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.install.not_started')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.install.dispatched')).toBe(false)
  })

  it('returns false for unknown event names', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.not.a.real.event')).toBe(false)
  })

  // The eight scan-pipeline failures from assetsTap's ALLOWED_EVENTS (prefix
  // plus bare event name, verified against assetsTap.ts's own
  // `${EVENT_PREFIX}${event}` construction).
  const ASSETS_ERROR_EVENTS = [
    'comfy.desktop.comfyui.assets.scanner.hash_failed',
    'comfy.desktop.comfyui.assets.scanner.enrich_failed',
    'comfy.desktop.comfyui.assets.scanner.fast_scan_failed',
    'comfy.desktop.comfyui.assets.scanner.temp_sync_failed',
    'comfy.desktop.comfyui.assets.scanner.mark_missing_failed',
    'comfy.desktop.comfyui.assets.scanner.stat_failed',
    'comfy.desktop.comfyui.assets.seeder.batch_insert_failed',
    'comfy.desktop.comfyui.assets.seeder.scan_failed'
  ]

  it('defines exactly eight assets error events', () => {
    expect(ASSETS_ERROR_EVENTS).toHaveLength(8)
  })

  it.each(ASSETS_ERROR_EVENTS)('mirrors the assets error event %s', (name) => {
    expect(isDatadogMirroredEvent(name)).toBe(true)
  })

  // Volume guard: scan_started fires once per scan (a funnel-timing event,
  // not a failure signal) and must stay PostHog-only, same shape as
  // boot_started / install.dispatched above.
  it('does not mirror seeder.scan_started (volume guard)', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.assets.seeder.scan_started')).toBe(false)
  })
})

describe('stripDatadogDroppedKeys', () => {
  // Datadog is the alerting surface: the large / high-cardinality diagnostic
  // fields belong in PostHog, not on RUM actions where they bloat payloads and
  // pollute facets.
  it('drops the large / high-cardinality diagnostic fields', () => {
    const context = {
      installation_id: 'abc',
      error_class: 'RuntimeError',
      error_bucket: 'unknown',
      exit_code: 1,
      signal: null,
      error_message: 'boom',
      error_signature: 'RuntimeError|boom',
      error_tail: 'line1\nline2',
      error_traceback: 'traceback',
      error_stack: 'stack',
      last_stderr: 'noise'
    }
    const out = stripDatadogDroppedKeys(context)
    expect(out).toEqual({
      installation_id: 'abc',
      error_class: 'RuntimeError',
      error_bucket: 'unknown',
      exit_code: 1,
      signal: null
    })
    // Does not mutate the input (PostHog copy must keep the full schema).
    expect(context.error_message).toBe('boom')
  })

  it('returns the same reference when no dropped keys are present', () => {
    const context = { error_class: 'RuntimeError', error_bucket: 'unknown' }
    expect(stripDatadogDroppedKeys(context)).toBe(context)
  })

  it('drop-list covers exactly the intended free-text / large fields', () => {
    expect([...DATADOG_DROPPED_CONTEXT_KEYS].sort()).toEqual([
      'error_message',
      'error_signature',
      'error_stack',
      'error_tail',
      'error_traceback',
      'last_stderr'
    ])
  })
})
