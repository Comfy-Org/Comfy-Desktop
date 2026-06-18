import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { CloudCapacityStatus, CloudUserTier } from '../types/ipc'

// vue-i18n: t() echoes its key so dialog copy is deterministic.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

// Hoisted so the mock factories can capture calls. The composable reads
// `useDialogs().confirm` and `emitTelemetryAction` once per `confirmEntry`,
// and these spies survive the per-test `vi.resetModules()` + dynamic import
// (the mock registry is keyed by module id, not by import instance).
const confirmSpy = vi.hoisted(() => vi.fn())
const emitSpy = vi.hoisted(() => vi.fn())

vi.mock('./useDialogs', () => ({
  useDialogs: () => ({ confirm: confirmSpy }),
}))

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: emitSpy,
}))

const ENTRY_BLOCKED = 'comfy.desktop.cloud.entry_blocked'

interface MockApi {
  getCloudCapacity: ReturnType<typeof vi.fn>
  getCloudUserTier: ReturnType<typeof vi.fn>
}

/**
 * Install a fresh `window.api` capacity source for the given flags, then
 * reset + re-import the module so its MODULE-LEVEL singleton (status /
 * userTier / loadPromise) starts clean and re-reads `window.api` from
 * scratch. Returns the composable handle plus the effectScope to stop.
 */
async function loadComposable(opts: {
  status: CloudCapacityStatus
  tier: CloudUserTier
}): Promise<{
  composable: ReturnType<Awaited<ReturnType<typeof importComposable>>>
  scope: ReturnType<typeof effectScope>
  api: MockApi
}> {
  const api: MockApi = {
    getCloudCapacity: vi.fn().mockResolvedValue(opts.status),
    getCloudUserTier: vi.fn().mockResolvedValue(opts.tier),
  }
  ;(window as unknown as { api: MockApi }).api = api

  // Fresh module per test so the singleton refs don't leak between cases.
  vi.resetModules()
  const useCloudCapacity = await importComposable()

  // onMounted only fires inside an active scope; wrap setup so the
  // composable mounts cleanly the way it does behind a component.
  const scope = effectScope()
  let composable!: ReturnType<typeof useCloudCapacity>
  scope.run(() => {
    composable = useCloudCapacity()
  })
  return { composable, scope, api }
}

async function importComposable() {
  const mod = await import('./useCloudCapacity')
  return mod.useCloudCapacity
}

beforeEach(() => {
  confirmSpy.mockReset()
  emitSpy.mockReset()
})

describe('useCloudCapacity.confirmEntry — cloud.entry_blocked telemetry', () => {
  it('status "normal": returns true and emits NOTHING (no gate engaged)', async () => {
    const { composable, scope } = await loadComposable({ status: 'normal', tier: 'free' })

    const ok = await composable.confirmEntry('picker')

    expect(ok).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(emitSpy).not.toHaveBeenCalled()
    scope.stop()
  })

  it('status "degraded" + confirm "primary": returns true, emits decision "proceeded"', async () => {
    confirmSpy.mockResolvedValue('primary')
    const { composable, scope } = await loadComposable({ status: 'degraded', tier: 'free' })

    const ok = await composable.confirmEntry('picker')

    expect(ok).toBe(true)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledWith(ENTRY_BLOCKED, {
      status: 'degraded',
      tier: 'free',
      decision: 'proceeded',
      source: 'picker',
    })
    scope.stop()
  })

  it('status "degraded" + confirm "cancel": returns false, emits decision "declined"', async () => {
    // useDialogs.confirm resolves anything !== 'primary' as a cancel; the
    // real driver returns `false` on cancel.
    confirmSpy.mockResolvedValue(false)
    const { composable, scope } = await loadComposable({ status: 'degraded', tier: 'free' })

    const ok = await composable.confirmEntry('picker')

    expect(ok).toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledWith(ENTRY_BLOCKED, {
      status: 'degraded',
      tier: 'free',
      decision: 'declined',
      source: 'picker',
    })
    scope.stop()
  })

  it('status "disabled" (non-paid): returns false, shows NO dialog, emits decision "no_op"', async () => {
    const { composable, scope } = await loadComposable({ status: 'disabled', tier: 'free' })

    const ok = await composable.confirmEntry('picker')

    expect(ok).toBe(false)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledWith(ENTRY_BLOCKED, {
      status: 'disabled',
      tier: 'free',
      decision: 'no_op',
      source: 'picker',
    })
    scope.stop()
  })

  it('status "disabled" + tier "paid": relaxed to a degraded confirm; event still reports raw status "disabled"', async () => {
    // Paid users are not hard-blocked by a kill-switch: the gate downgrades
    // 'disabled' to a 'degraded' confirm, but the emitted event carries the
    // RAW flag so the funnel sees status:'disabled', tier:'paid'.
    confirmSpy.mockResolvedValue('primary')
    const { composable, scope } = await loadComposable({ status: 'disabled', tier: 'paid' })

    const ok = await composable.confirmEntry('picker')

    expect(ok).toBe(true)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledWith(ENTRY_BLOCKED, {
      status: 'disabled',
      tier: 'paid',
      decision: 'proceeded',
      source: 'picker',
    })
    scope.stop()
  })

  it('status "disabled" + tier "paid" + cancel: relaxed confirm declined reports decision "declined"', async () => {
    // Confirms the relaxed-confirm decision tracks the dialog outcome too.
    confirmSpy.mockResolvedValue(false)
    const { composable, scope } = await loadComposable({ status: 'disabled', tier: 'paid' })

    const ok = await composable.confirmEntry('picker')

    expect(ok).toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledWith(ENTRY_BLOCKED, {
      status: 'disabled',
      tier: 'paid',
      decision: 'declined',
      source: 'picker',
    })
    scope.stop()
  })

  it('passes the source argument through to the event ("first_use")', async () => {
    confirmSpy.mockResolvedValue('primary')
    const { composable, scope } = await loadComposable({ status: 'degraded', tier: 'unknown' })

    await composable.confirmEntry('first_use')

    expect(emitSpy).toHaveBeenCalledWith(ENTRY_BLOCKED, {
      status: 'degraded',
      tier: 'unknown',
      decision: 'proceeded',
      source: 'first_use',
    })
    scope.stop()
  })
})
