import { describe, expect, it } from 'vitest'

import {
  isDatadogMirroredEvent,
  stripDatadogDroppedKeys,
  DATADOG_DROPPED_CONTEXT_KEYS,
} from './datadogMirroredEvents'

describe('isDatadogMirroredEvent', () => {
  // The boot lifecycle splits success vs failure: boot_failed is a failure
  // signal ops alerts on, boot_started/boot_completed are funnel events
  // (PostHog only). Mirroring a success event would page on-call on healthy
  // boots and double its RUM volume for no monitor benefit.
  it('mirrors boot_failed but not boot_started / boot_completed', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_failed')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_started')).toBe(false)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_completed')).toBe(false)
  })

  it('returns false for unknown event names', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.not.a.real.event')).toBe(false)
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
      last_stderr: 'noise',
    }
    const out = stripDatadogDroppedKeys(context)
    expect(out).toEqual({
      installation_id: 'abc',
      error_class: 'RuntimeError',
      error_bucket: 'unknown',
      exit_code: 1,
      signal: null,
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
      'error_tail',
      'last_stderr',
    ])
  })
})
