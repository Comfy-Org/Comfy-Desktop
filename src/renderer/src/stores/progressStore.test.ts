import { createTestingPinia } from '@pinia/testing'
import { stubWindowApi } from '../lib/stubWindowApi'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionResult, ProgressData } from '../types/ipc'
import type * as TelemetryModule from '../lib/telemetry'
import { useProgressStore } from './progressStore'
import { useSessionStore } from './sessionStore'

vi.mock('vue-i18n', async (importOriginal) =>
  (await import('../lib/vueI18nWithAppMessages')).vueI18nWithAppMessages(importOriginal)
)

vi.mock('../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof TelemetryModule>()),
  emitTelemetryAction: vi.fn()
}))

stubWindowApi({
  getInstallations: vi.fn().mockResolvedValue([]),
  onInstallationsChanged: vi.fn(),
  onInstallationsVersionsUpdated: vi.fn(),
  onInstallProgress: vi.fn(() => vi.fn()),
  onComfyOutput: vi.fn(() => vi.fn()),
  logsSnapshot: vi.fn().mockResolvedValue(''),
  cancelOperation: vi.fn(),
  stopComfyUI: vi.fn(),
  getRunningInstances: vi.fn().mockResolvedValue([]),
  onInstanceStarted: vi.fn(() => vi.fn()),
  onInstanceStopped: vi.fn(() => vi.fn()),
  onComfyExited: vi.fn(() => vi.fn()),
  onErrorDetail: vi.fn(() => vi.fn())
})

describe('useProgressStore', () => {
  let store: ReturnType<typeof useProgressStore>
  let sessionStore: ReturnType<typeof useSessionStore>

  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    store = useProgressStore()
    sessionStore = useSessionStore()
    vi.clearAllMocks()
  })

  describe('getProgressInfo', () => {
    it('returns null when no operation exists', () => {
      expect(store.getProgressInfo('inst-1')).toBeNull()
    })

    it('returns null when operation is finished', async () => {
      const apiCall = vi.fn().mockResolvedValue({ ok: true } as ActionResult)
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      await vi.waitFor(() => {
        expect(store.operations.get('inst-1')?.finished).toBe(true)
      })

      expect(store.getProgressInfo('inst-1')).toBeNull()
    })

    it('returns flat status and percent when no steps defined', () => {
      const apiCall = () => new Promise<ActionResult>(() => {})
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      const op = store.operations.get('inst-1')!
      op.flatStatus = 'Downloading...'
      op.flatPercent = 42

      const info = store.getProgressInfo('inst-1')
      expect(info).toEqual({ status: 'Downloading...', percent: 42 })
    })

    it('returns step-based status when steps and activePhase are set', () => {
      const apiCall = () => new Promise<ActionResult>(() => {})
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      const op = store.operations.get('inst-1')!
      op.steps = [
        { phase: 'download', label: 'Download' },
        { phase: 'extract', label: 'Extract' }
      ]
      op.activePhase = 'download'
      op.lastStatus['download'] = 'Fetching files...'
      op.activePercent = 75

      const info = store.getProgressInfo('inst-1')
      expect(info).toEqual({ status: 'Fetching files...', percent: 75 })
    })

    it('falls back to step label, not the raw phase id, when lastStatus has no entry', () => {
      const apiCall = () => new Promise<ActionResult>(() => {})
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      const op = store.operations.get('inst-1')!
      op.steps = [{ phase: 'download', label: 'Download' }]
      op.activePhase = 'download'
      op.activePercent = 0

      const info = store.getProgressInfo('inst-1')
      expect(info).toEqual({ status: 'Download', percent: 0 })
    })

    it('falls back to title when flatStatus is empty', () => {
      const apiCall = () => new Promise<ActionResult>(() => {})
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      const op = store.operations.get('inst-1')!
      op.flatStatus = ''

      const info = store.getProgressInfo('inst-1')
      expect(info?.status).toBe('Install')
    })
  })

  describe('startOperation', () => {
    it('clears a pre-existing error instance for the same installation', () => {
      sessionStore.startSession('inst-1')
      sessionStore.errorInstances.set('inst-1', {
        installationName: 'Test',
        message: 'previous failure'
      })

      store.startOperation({
        installationId: 'inst-1',
        title: 'Delete',
        apiCall: () => new Promise<ActionResult>(() => {})
      })

      expect(sessionStore.errorInstances.has('inst-1')).toBe(false)
    })

    it('creates an operation and sets up session', () => {
      const apiCall = () => new Promise<ActionResult>(() => {})
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install ComfyUI',
        apiCall
      })

      expect(store.operations.has('inst-1')).toBe(true)
      const op = store.operations.get('inst-1')!
      expect(op.title).toBe('Install ComfyUI')
      expect(op.finished).toBe(false)
      expect(op.error).toBeNull()
    })

    it('subscribes to progress and output IPC', () => {
      const apiCall = () => new Promise<ActionResult>(() => {})
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      expect(window.api.onInstallProgress).toHaveBeenCalled()
      expect(window.api.onComfyOutput).toHaveBeenCalled()
    })

    it('marks operation finished with error on apiCall rejection', async () => {
      const apiCall = vi.fn().mockRejectedValue(new Error('Network failure'))
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      await vi.waitFor(() => {
        expect(store.operations.get('inst-1')?.finished).toBe(true)
      })

      const op = store.operations.get('inst-1')!
      expect(op.error).toBe('Network failure')
    })

    it('marks operation finished on successful apiCall', async () => {
      const apiCall = vi.fn().mockResolvedValue({ ok: true } as ActionResult)
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      await vi.waitFor(() => {
        expect(store.operations.get('inst-1')?.finished).toBe(true)
      })

      const op = store.operations.get('inst-1')!
      expect(op.error).toBeNull()
      expect(op.result).toEqual({ ok: true })
    })

    it('sets error on non-ok result', async () => {
      const apiCall = vi
        .fn()
        .mockResolvedValue({ ok: false, message: 'Bad config' } as ActionResult)
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall
      })

      await vi.waitFor(() => {
        expect(store.operations.get('inst-1')?.finished).toBe(true)
      })

      const op = store.operations.get('inst-1')!
      expect(op.error).toBe('Bad config')
      expect(sessionStore.errorInstances.has('inst-1')).toBe(true)
    })

    it('does not set error on cancelled result', async () => {
      const apiCall = vi.fn().mockResolvedValue({ ok: false, cancelled: true } as ActionResult)
      store.startOperation({
        installationId: 'inst-1',
        title: 'Launch',
        apiCall
      })

      await vi.waitFor(() => {
        expect(store.operations.get('inst-1')?.finished).toBe(true)
      })

      const op = store.operations.get('inst-1')!
      expect(op.error).toBeNull()
      expect(op.result?.cancelled).toBe(true)
      expect(sessionStore.errorInstances.has('inst-1')).toBe(false)
    })

    it('clears active session on cancellation', async () => {
      const apiCall = vi.fn().mockResolvedValue({ ok: false, cancelled: true } as ActionResult)
      store.startOperation({
        installationId: 'inst-1',
        title: 'Launch',
        apiCall
      })

      await vi.waitFor(() => {
        expect(store.operations.get('inst-1')?.finished).toBe(true)
      })

      expect(sessionStore.activeSessions.has('inst-1')).toBe(false)
    })

    it('cleans up previous operation for same installationId', () => {
      const unsub1 = vi.fn()
      vi.mocked(window.api.onInstallProgress).mockReturnValueOnce(unsub1)

      store.startOperation({
        installationId: 'inst-1',
        title: 'First',
        apiCall: () => new Promise<ActionResult>(() => {})
      })

      store.startOperation({
        installationId: 'inst-1',
        title: 'Second',
        apiCall: () => new Promise<ActionResult>(() => {})
      })

      expect(store.operations.get('inst-1')?.title).toBe('Second')
    })

    it('sets result on port conflict without error', async () => {
      const portConflictInfo = { port: 8188, pids: [123], isComfy: true }
      const apiCall = vi
        .fn()
        .mockResolvedValue({ ok: false, portConflict: portConflictInfo } as ActionResult)
      store.startOperation({
        installationId: 'inst-1',
        title: 'Launch',
        apiCall
      })

      await vi.waitFor(() => {
        expect(store.operations.get('inst-1')?.finished).toBe(true)
      })

      const op = store.operations.get('inst-1')!
      expect(op.error).toBeNull()
      expect(op.result?.portConflict).toEqual(portConflictInfo)
      expect(sessionStore.errorInstances.has('inst-1')).toBe(false)
    })

    it('handles synchronous apiCall throw', () => {
      const apiCall = () => {
        throw new Error('Sync boom')
      }
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall: apiCall as unknown as () => Promise<ActionResult>
      })

      const op = store.operations.get('inst-1')!
      expect(op.error).toBe('Sync boom')
      expect(op.finished).toBe(true)
    })
  })

  describe('cancelOperation', () => {
    it('sets cancelRequested and calls IPC cancel/stop', () => {
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall: () => new Promise<ActionResult>(() => {})
      })

      store.cancelOperation('inst-1')

      const op = store.operations.get('inst-1')!
      expect(op.cancelRequested).toBe(true)
      expect(window.api.cancelOperation).toHaveBeenCalledWith('inst-1')
      expect(window.api.stopComfyUI).toHaveBeenCalledWith('inst-1')
    })

    it('is safe to cancel a nonexistent operation', () => {
      expect(() => store.cancelOperation('nonexistent')).not.toThrow()
    })

    it('does NOT stop ComfyUI when the op has already finished', async () => {
      let resolve: ((value: ActionResult) => void) | null = null
      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall: () =>
          new Promise<ActionResult>((r) => {
            resolve = r
          })
      })
      resolve!({ ok: true })
      await Promise.resolve()
      await Promise.resolve()
      const op = store.operations.get('inst-1')!
      expect(op.finished).toBe(true)

      vi.mocked(window.api.stopComfyUI).mockClear()
      vi.mocked(window.api.cancelOperation).mockClear()
      store.cancelOperation('inst-1')

      expect(window.api.stopComfyUI).not.toHaveBeenCalled()
      expect(window.api.cancelOperation).not.toHaveBeenCalled()
      expect(op.cancelRequested).toBe(false)
    })
  })

  describe('onErrorDetail subscription', () => {
    it('does not throw at construction when window.api.onErrorDetail is undefined', () => {
      const orig = window.api.onErrorDetail
      // @ts-expect-error
      window.api.onErrorDetail = undefined
      try {
        setActivePinia(createTestingPinia({ stubActions: false }))
        expect(() => useProgressStore()).not.toThrow()
      } finally {
        window.api.onErrorDetail = orig
      }
    })
  })

  describe('cleanupOperation', () => {
    it('calls unsubscribe functions', () => {
      const unsubProgress = vi.fn()
      const unsubOutput = vi.fn()
      vi.mocked(window.api.onInstallProgress).mockReturnValueOnce(unsubProgress)
      vi.mocked(window.api.onComfyOutput).mockReturnValueOnce(unsubOutput)

      store.startOperation({
        installationId: 'inst-1',
        title: 'Install',
        apiCall: () => new Promise<ActionResult>(() => {})
      })

      store.cleanupOperation('inst-1')

      expect(unsubProgress).toHaveBeenCalled()
      expect(unsubOutput).toHaveBeenCalled()
    })

    it('is safe to cleanup a nonexistent operation', () => {
      expect(() => store.cleanupOperation('nonexistent')).not.toThrow()
    })
  })

  describe('Operation.chainSpan', () => {
    it('persists chainSpan on the Operation when set', () => {
      store.startOperation({
        installationId: 'inst-1',
        title: 'Installing — DevFixture',
        apiCall: () => new Promise<ActionResult>(() => {}),
        chainSpan: 'install'
      })
      expect(store.operations.get('inst-1')?.chainSpan).toBe('install')
    })

    it('persists chainSpan=launch for the launch leg of a chain', () => {
      store.startOperation({
        installationId: 'inst-2',
        title: 'Launching — DevFixture',
        apiCall: () => new Promise<ActionResult>(() => {}),
        chainSpan: 'launch'
      })
      expect(store.operations.get('inst-2')?.chainSpan).toBe('launch')
    })

    it('defaults chainSpan to null when omitted', () => {
      store.startOperation({
        installationId: 'inst-3',
        title: 'Standalone op',
        apiCall: () => new Promise<ActionResult>(() => {})
      })
      expect(store.operations.get('inst-3')?.chainSpan).toBeNull()
    })

    it('seeds the launch leg terminalOutput from logsSnapshot (log continuity)', async () => {
      vi.mocked(window.api.logsSnapshot).mockResolvedValueOnce('install-leg lines\n')
      store.startOperation({
        installationId: 'inst-snap',
        title: 'Launching',
        apiCall: () => new Promise<ActionResult>(() => {}),
        chainSpan: 'launch'
      })
      expect(window.api.logsSnapshot).toHaveBeenCalledWith('inst-snap')
      await Promise.resolve()
      await Promise.resolve()
      expect(store.operations.get('inst-snap')?.terminalOutput).toBe('install-leg lines\n')
    })

    it('does not seed from logsSnapshot for a non-launch op', () => {
      vi.mocked(window.api.logsSnapshot).mockClear()
      store.startOperation({
        installationId: 'inst-nosnap',
        title: 'Install',
        apiCall: () => new Promise<ActionResult>(() => {}),
        chainSpan: 'install'
      })
      expect(window.api.logsSnapshot).not.toHaveBeenCalled()
    })

    it('caps the install leg of a chain at 0–70% of the continuous bar', () => {
      store.startOperation({
        installationId: 'inst-4',
        title: 'Installing',
        apiCall: () => new Promise<ActionResult>(() => {}),
        chainSpan: 'install'
      })
      const op = store.operations.get('inst-4')!
      op.steps = [
        { phase: 'download', label: 'Download' },
        { phase: 'extract', label: 'Extract' }
      ]
      op.activePhase = 'download'
      op.activePercent = 50

      const result = store.globalProgressFor(op)
      expect(result.percent).toBeGreaterThan(0)
      expect(result.percent).toBeLessThan(70)
      expect(result.indeterminate).toBe(false)
    })

    it('a finished+ok install leg reports 70, not 100 (chain hands off to launch)', () => {
      store.startOperation({
        installationId: 'inst-5',
        title: 'Installing',
        apiCall: () => new Promise<ActionResult>(() => {}),
        chainSpan: 'install'
      })
      const op = store.operations.get('inst-5')!
      op.steps = [{ phase: 'download', label: 'Download' }]
      op.finished = true
      op.result = { ok: true } as ActionResult

      expect(store.globalProgressFor(op).percent).toBe(70)
    })

    it('a finished+ok standalone op reports 100', () => {
      store.startOperation({
        installationId: 'inst-6',
        title: 'Updating',
        apiCall: () => new Promise<ActionResult>(() => {})
      })
      const op = store.operations.get('inst-6')!
      op.finished = true
      op.result = { ok: true } as ActionResult

      expect(store.globalProgressFor(op).percent).toBe(100)
    })
  })

  describe('a standalone install, as its progress events arrive', () => {
    function startInstall(): {
      receive: (event: Omit<ProgressData, 'installationId'>) => void
      barPercent: () => number
    } {
      store.startOperation({
        installationId: 'build-1',
        title: 'Installing',
        apiCall: () => new Promise<ActionResult>(() => {}),
        opKind: 'install'
      })
      const onProgress = vi.mocked(window.api.onInstallProgress).mock.calls.at(-1)![0] as (
        data: ProgressData
      ) => void
      return {
        receive: (event) => onProgress({ installationId: 'build-1', ...event }),
        barPercent: () =>
          Math.round(store.globalProgressFor(store.operations.get('build-1')!).percent)
      }
    }

    const fourSteps = [
      { phase: 'download', label: 'Download' },
      { phase: 'extract', label: 'Extract' },
      { phase: 'setup', label: 'Set up environment' },
      { phase: 'update', label: 'Get ComfyUI v0.3.50' }
    ]

    it('holds the bar where the package copy left it while the rest of Set up environment runs', () => {
      const install = startInstall()
      install.receive({ phase: 'steps', steps: fourSteps })

      const bar: number[] = []
      const after = (event: Omit<ProgressData, 'installationId'>): void => {
        install.receive(event)
        bar.push(install.barPercent())
      }
      after({ phase: 'download', percent: 100, status: 'Downloading… 3 / 3 MB' })
      after({ phase: 'extract', percent: 100, status: 'Extracting… 100%' })
      after({ phase: 'setup', percent: 0, status: 'Creating Python environment…' })
      after({ phase: 'setup', percent: 100, status: 'Copying packages… 9 / 9 files' })
      after({ phase: 'setup', percent: -1, status: 'Removing duplicate packages…' })
      after({ phase: 'setup', percent: -1, status: 'Fetching version tags…' })
      after({ phase: 'update', percent: -1, status: 'Checking the version in this download…' })
      after({ phase: 'update', percent: 100, status: 'Now on ComfyUI v0.3.50' })

      expect(bar).toEqual([40, 60, 60, 90, 90, 90, 90, 99])
    })
  })
})

describe('a later start supersedes a failed one', () => {
  function freshStore() {
    setActivePinia(createTestingPinia({ stubActions: false }))
    const store = useProgressStore()
    const started = vi
      .mocked(window.api.onInstanceStarted)
      .mock.calls.at(-1)![0] as unknown as (data: { installationId: string }) => void
    return { store, started }
  }

  function finishedOp(opKind: string, error: string | null) {
    return { opKind, finished: true, cancelRequested: false, error } as never
  }

  it('drops the failed start once the build starts again', () => {
    const { store, started } = freshStore()
    store.operations.set('a', finishedOp('launch', 'Port 8188 is in use'))

    started({ installationId: 'a' })

    expect(store.operations.has('a')).toBe(false)
  })

  it('keeps a failed install and a start still in progress', () => {
    const { store, started } = freshStore()
    store.operations.set('a', finishedOp('install', 'Disk full'))
    store.operations.set('b', {
      opKind: 'launch',
      finished: false,
      cancelRequested: false,
      error: null
    } as never)

    started({ installationId: 'a' })
    started({ installationId: 'b' })

    expect(store.operations.has('a')).toBe(true)
    expect(store.operations.has('b')).toBe(true)
  })
})
