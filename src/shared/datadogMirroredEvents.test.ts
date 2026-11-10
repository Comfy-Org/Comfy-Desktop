import { describe, expect, it } from 'vitest'

import {
  isDatadogMirroredEvent,
  stripDatadogDroppedKeys,
  DATADOG_DROPPED_CONTEXT_KEYS
} from './datadogMirroredEvents'

describe('isDatadogMirroredEvent', () => {
  it('mirrors boot_failed but not boot_started / boot_completed', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_failed')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.asset_scan_error')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_started')).toBe(false)
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.boot_completed')).toBe(false)
  })

  it('mirrors view_token_mint_failed but not view_token_minted', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.auth.view_token_mint_failed')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.auth.view_token_minted')).toBe(false)
  })

  it('mirrors workspace_switch_browser but not workspace_switch', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.auth.workspace_switch_browser')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.auth.workspace_returned_to_anchor')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.auth.mint_scope_not_granted')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.auth.workspace_switch')).toBe(false)
  })

  it('mirrors install.not_started but not install.dispatched', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.install.not_started')).toBe(true)
    expect(isDatadogMirroredEvent('comfy.desktop.install.dispatched')).toBe(false)
  })

  it.each([
    ['comfy.desktop.auth.host_sign_in', true],
    ['comfy.desktop.auth.sign_in_failed', true],
    ['comfy.desktop.auth.sign_in_started', false]
  ])('mirrors %s: %s', (name, mirrored) => {
    expect(isDatadogMirroredEvent(name)).toBe(mirrored)
  })

  it.each([
    ['comfy.desktop.comfyui.agent.startup_failed', true],
    ['comfy.desktop.comfyui.agent.startup_stalled', true],
    ['comfy.desktop.comfyui.agent.health_check_failed', true],
    ['comfy.desktop.comfyui.agent.agent_error', true],
    ['comfy.desktop.comfyui.agent.document_host_degraded', true],
    ['comfy.desktop.comfyui.agent.startup_step', false],
    ['comfy.desktop.comfyui.agent.agent_started', false]
  ])('mirrors %s: %s', (name, mirrored) => {
    expect(isDatadogMirroredEvent(name)).toBe(mirrored)
  })

  it('returns false for unknown event names', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.not.a.real.event')).toBe(false)
  })

  const ASSETS_ERROR_EVENTS = [
    'comfy.desktop.comfyui.assets.scanner.hash_failed',
    'comfy.desktop.comfyui.assets.scanner.enrich_failed',
    'comfy.desktop.comfyui.assets.scanner.fast_scan_failed',
    'comfy.desktop.comfyui.assets.scanner.temp_sync_failed',
    'comfy.desktop.comfyui.assets.scanner.mark_missing_failed',
    'comfy.desktop.comfyui.assets.scanner.stat_failed',
    'comfy.desktop.comfyui.assets.scanner.watch_stat_failed',
    'comfy.desktop.comfyui.assets.scanner.watch_spec_failed',
    'comfy.desktop.comfyui.assets.scanner.watch_seed_failed',
    'comfy.desktop.comfyui.assets.scanner.root_unreachable',
    'comfy.desktop.comfyui.assets.scanner.walk_failed',
    'comfy.desktop.comfyui.assets.scanner.metadata_failed',
    'comfy.desktop.comfyui.assets.seeder.batch_insert_failed',
    'comfy.desktop.comfyui.assets.seeder.scan_failed'
  ]

  it('defines exactly fourteen assets error events', () => {
    expect(ASSETS_ERROR_EVENTS).toHaveLength(14)
  })

  it.each(ASSETS_ERROR_EVENTS)('mirrors the assets error event %s', (name) => {
    expect(isDatadogMirroredEvent(name)).toBe(true)
  })

  it('does not mirror seeder.scan_started (volume guard)', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.assets.seeder.scan_started')).toBe(false)
  })

  it('does not mirror scanner.failure_bucket', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.assets.scanner.failure_bucket')).toBe(
      false
    )
  })

  it('does not mirror scanner.invalid_mtime', () => {
    expect(isDatadogMirroredEvent('comfy.desktop.comfyui.assets.scanner.invalid_mtime')).toBe(false)
  })
})

describe('stripDatadogDroppedKeys', () => {
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
