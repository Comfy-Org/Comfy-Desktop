import { describe, expect, it } from 'vitest'

import { isDatadogMirroredEvent } from './datadogMirroredEvents'

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
