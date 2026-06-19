// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./telemetry', () => ({
  emit: vi.fn(),
}))

import * as telemetry from './telemetry'
import {
  startBootPhases,
  recordBootPhase,
  clearBootPhases,
  flushBootPhasesOnFailure,
  _peekBootPhases,
  _resetForTest,
} from './bootPhaseBuffer'

const mockedEmit = vi.mocked(telemetry.emit)

const BOOT_PHASE_EVENT = 'comfy.desktop.comfyui.boot_phase'

beforeEach(() => {
  vi.useFakeTimers()
  // Pin a deterministic epoch so ms_since_boot_started is reproducible.
  vi.setSystemTime(new Date('2026-06-16T00:00:00.000Z'))
  _resetForTest()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startBootPhases', () => {
  it('resets any stale buffer for the same id', () => {
    startBootPhases('inst-1', 'nightly')
    recordBootPhase('inst-1', 'spawn')
    recordBootPhase('inst-1', 'gpu')
    expect(_peekBootPhases('inst-1')).toHaveLength(2)

    // A new attempt on the same id wipes the prior attempt's entries.
    startBootPhases('inst-1', 'stable')
    expect(_peekBootPhases('inst-1')).toEqual([])
  })

  it('measures ms_since_boot_started from the latest start, not the stale one', () => {
    startBootPhases('inst-1', 'nightly')
    vi.advanceTimersByTime(9999)
    recordBootPhase('inst-1', 'old')

    // Restart resets bootStartedAt to "now".
    startBootPhases('inst-1', 'nightly')
    vi.advanceTimersByTime(120)
    recordBootPhase('inst-1', 'spawn')

    const reached = flushBootPhasesOnFailure('inst-1')
    expect(reached).toBe('spawn')
    expect(mockedEmit).toHaveBeenCalledTimes(1)
    expect(mockedEmit).toHaveBeenCalledWith(BOOT_PHASE_EVENT, {
      installation_id: 'inst-1',
      variant: 'nightly',
      phase: 'spawn',
      ms_since_boot_started: 120,
    })
  })
})

describe('recordBootPhase', () => {
  it('records one entry per phase with ms_since_boot_started', () => {
    startBootPhases('inst-1', 'stable')

    vi.advanceTimersByTime(100)
    recordBootPhase('inst-1', 'spawn')

    vi.advanceTimersByTime(400)
    recordBootPhase('inst-1', 'gpu')

    expect(_peekBootPhases('inst-1')).toEqual([
      { phase: 'spawn', msSinceBootStarted: 100 },
      { phase: 'gpu', msSinceBootStarted: 500 },
    ])
  })

  it('keeps the FIRST entry per phase and ignores re-recording the same phase', () => {
    startBootPhases('inst-1', 'stable')

    vi.advanceTimersByTime(100)
    recordBootPhase('inst-1', 'gpu')

    // Re-entry / skip-advance into a phase already seen is a no-op.
    vi.advanceTimersByTime(900)
    recordBootPhase('inst-1', 'gpu')

    expect(_peekBootPhases('inst-1')).toEqual([{ phase: 'gpu', msSinceBootStarted: 100 }])
  })

  it('is a no-op when no buffer is active for the id', () => {
    // No startBootPhases called for this id.
    recordBootPhase('inst-unknown', 'spawn')
    expect(_peekBootPhases('inst-unknown')).toBeNull()
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('is a no-op after a terminal flush dropped the buffer', () => {
    startBootPhases('inst-1', 'stable')
    recordBootPhase('inst-1', 'spawn')
    flushBootPhasesOnFailure('inst-1')

    recordBootPhase('inst-1', 'gpu')
    expect(_peekBootPhases('inst-1')).toBeNull()
  })
})

describe('clearBootPhases (success path)', () => {
  it('emits nothing and drops the buffer', () => {
    startBootPhases('inst-1', 'stable')
    recordBootPhase('inst-1', 'spawn')
    recordBootPhase('inst-1', 'gpu')

    clearBootPhases('inst-1')

    expect(mockedEmit).not.toHaveBeenCalled()
    expect(_peekBootPhases('inst-1')).toBeNull()
  })

  it('is safe when no buffer exists for the id', () => {
    expect(() => clearBootPhases('inst-unknown')).not.toThrow()
    expect(mockedEmit).not.toHaveBeenCalled()
  })
})

describe('flushBootPhasesOnFailure', () => {
  it('emits exactly one boot_phase per buffered phase with the full payload', () => {
    startBootPhases('inst-1', 'nightly')

    vi.advanceTimersByTime(200)
    recordBootPhase('inst-1', 'spawn')

    vi.advanceTimersByTime(300)
    recordBootPhase('inst-1', 'gpu')

    vi.advanceTimersByTime(1000)
    recordBootPhase('inst-1', 'ready')

    const reached = flushBootPhasesOnFailure('inst-1')

    expect(reached).toBe('ready')
    expect(mockedEmit).toHaveBeenCalledTimes(3)
    expect(mockedEmit).toHaveBeenNthCalledWith(1, BOOT_PHASE_EVENT, {
      installation_id: 'inst-1',
      variant: 'nightly',
      phase: 'spawn',
      ms_since_boot_started: 200,
    })
    expect(mockedEmit).toHaveBeenNthCalledWith(2, BOOT_PHASE_EVENT, {
      installation_id: 'inst-1',
      variant: 'nightly',
      phase: 'gpu',
      ms_since_boot_started: 500,
    })
    expect(mockedEmit).toHaveBeenNthCalledWith(3, BOOT_PHASE_EVENT, {
      installation_id: 'inst-1',
      variant: 'nightly',
      phase: 'ready',
      ms_since_boot_started: 1500,
    })
  })

  it('carries variant: null through to the emitted payload', () => {
    startBootPhases('inst-1', null)
    vi.advanceTimersByTime(50)
    recordBootPhase('inst-1', 'spawn')

    flushBootPhasesOnFailure('inst-1')

    expect(mockedEmit).toHaveBeenCalledWith(BOOT_PHASE_EVENT, {
      installation_id: 'inst-1',
      variant: null,
      phase: 'spawn',
      ms_since_boot_started: 50,
    })
  })

  it('returns the LAST phase id reached', () => {
    startBootPhases('inst-1', 'stable')
    recordBootPhase('inst-1', 'spawn')
    recordBootPhase('inst-1', 'gpu')
    recordBootPhase('inst-1', 'ready')

    expect(flushBootPhasesOnFailure('inst-1')).toBe('ready')
  })

  it('returns null and emits nothing when there is no buffer', () => {
    expect(flushBootPhasesOnFailure('inst-unknown')).toBeNull()
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('returns null and emits nothing when the buffer is empty (no phase ever recorded)', () => {
    startBootPhases('inst-1', 'stable')

    expect(flushBootPhasesOnFailure('inst-1')).toBeNull()
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('clears the buffer afterward so a second flush is a no-op', () => {
    startBootPhases('inst-1', 'stable')
    recordBootPhase('inst-1', 'spawn')

    expect(flushBootPhasesOnFailure('inst-1')).toBe('spawn')
    expect(mockedEmit).toHaveBeenCalledTimes(1)
    expect(_peekBootPhases('inst-1')).toBeNull()

    mockedEmit.mockClear()
    expect(flushBootPhasesOnFailure('inst-1')).toBeNull()
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('keeps buffers isolated per installation id', () => {
    startBootPhases('inst-a', 'stable')
    startBootPhases('inst-b', 'nightly')

    vi.advanceTimersByTime(10)
    recordBootPhase('inst-a', 'spawn')
    recordBootPhase('inst-b', 'spawn')

    // Flushing one id leaves the other intact.
    expect(flushBootPhasesOnFailure('inst-a')).toBe('spawn')
    expect(_peekBootPhases('inst-b')).toEqual([{ phase: 'spawn', msSinceBootStarted: 10 }])

    mockedEmit.mockClear()
    expect(flushBootPhasesOnFailure('inst-b')).toBe('spawn')
    expect(mockedEmit).toHaveBeenCalledWith(BOOT_PHASE_EVENT, {
      installation_id: 'inst-b',
      variant: 'nightly',
      phase: 'spawn',
      ms_since_boot_started: 10,
    })
  })
})
