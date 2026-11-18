import { useSessionStore } from '../stores/sessionStore'
import type { ActionResult, ShowProgressOpts } from '../types/ipc'

export interface InjectProgressErrorOpts {
  installationId: string
  title?: string
  errorMessage: string
}

export interface InjectProgressSuccessOpts {
  installationId: string
  title?: string
  newInstallationId?: string
}

export interface InjectRetryableProgressErrorOpts {
  installationId: string
  title?: string
  errorMessage: string
  failuresBeforeSuccess?: number
}

export interface InjectPortConflictResultOpts {
  installationId: string
  title?: string
  port: number
  nextPort?: number
  isComfy?: boolean
  pids?: number[]
}

export interface SeedErrorInstanceOpts {
  installationId: string
  installationName: string
  message?: string
}

export interface StartInFlightOpOpts {
  installationId: string
  title?: string
  opKind?: ShowProgressOpts['opKind']
  destroysInstance?: boolean
  triggersInstanceStart?: boolean
}

export interface SettleInFlightOpOpts {
  installationId: string
  result: ActionResult
}

interface PanelBindings {
  showProgress: (opts: ShowProgressOpts) => Promise<void> | void
  actionGuard: { checkBeforeAction: (id: string, label: string) => Promise<boolean> }
}

let bindings: PanelBindings | null = null

const injectedApiCallCounts = new Map<string, number>()

const inFlightSettlers = new Map<string, (result: ActionResult) => void>()

export interface E2ERendererHelpers {
  injectProgressError(opts: InjectProgressErrorOpts): Promise<void>
  injectProgressSuccess(opts: InjectProgressSuccessOpts): Promise<void>
  isRunning(installationId: string): boolean
  injectRetryableProgressError(opts: InjectRetryableProgressErrorOpts): Promise<void>
  injectPortConflictResult(opts: InjectPortConflictResultOpts): Promise<void>
  seedErrorInstance(opts: SeedErrorInstanceOpts): void
  hasErrorInstance(installationId: string): boolean
  getInjectedApiCallCount(installationId: string): number
  startInFlightOp(opts: StartInFlightOpOpts): Promise<void>
  settleInFlightOp(opts: SettleInFlightOpOpts): boolean
  runActionGuard(opts: { installationId: string; actionLabel: string }): Promise<boolean>
}

function ensureBound(): PanelBindings {
  if (!bindings) {
    throw new Error('__e2eRenderer not bound yet — PanelApp has not mounted')
  }
  return bindings
}

export function bindE2EPanelHooks(next: PanelBindings | null): void {
  bindings = next
}

export function registerE2ERendererHooks(): void {
  const helpers: E2ERendererHelpers = {
    async injectProgressError({ installationId, title, errorMessage }) {
      const b = ensureBound()
      await b.showProgress({
        installationId,
        title: title ?? `Failed op — ${installationId}`,
        opKind: 'generic',
        apiCall: () => Promise.resolve({ ok: false, message: errorMessage })
      })
    },
    async injectProgressSuccess({ installationId, title, newInstallationId }) {
      const b = ensureBound()
      await b.showProgress({
        installationId,
        title: title ?? `Copy — ${installationId}`,
        opKind: 'generic',
        apiCall: () =>
          Promise.resolve({
            ok: true,
            navigate: 'list',
            newInstallationId
          })
      })
    },
    isRunning(installationId) {
      return useSessionStore().isRunning(installationId)
    },
    async injectRetryableProgressError({
      installationId,
      title,
      errorMessage,
      failuresBeforeSuccess
    }) {
      const b = ensureBound()
      const failsRequired = failuresBeforeSuccess ?? 1
      injectedApiCallCounts.set(installationId, 0)
      await b.showProgress({
        installationId,
        title: title ?? `Retryable failed op — ${installationId}`,
        opKind: 'generic',
        apiCall: () => {
          const next = (injectedApiCallCounts.get(installationId) ?? 0) + 1
          injectedApiCallCounts.set(installationId, next)
          return next <= failsRequired
            ? Promise.resolve({ ok: false, message: errorMessage })
            : Promise.resolve({ ok: true })
        }
      })
    },
    async injectPortConflictResult({ installationId, title, port, nextPort, isComfy, pids }) {
      const b = ensureBound()
      injectedApiCallCounts.set(installationId, 0)
      await b.showProgress({
        installationId,
        title: title ?? `Launching ComfyUI`,
        opKind: 'generic',
        triggersInstanceStart: true,
        apiCall: () => {
          const next = (injectedApiCallCounts.get(installationId) ?? 0) + 1
          injectedApiCallCounts.set(installationId, next)
          return Promise.resolve({
            ok: false,
            portConflict: {
              port,
              ...(pids !== undefined ? { pids } : {}),
              ...(nextPort !== undefined ? { nextPort } : {}),
              ...(isComfy !== undefined ? { isComfy } : {})
            }
          })
        }
      })
    },
    seedErrorInstance({ installationId, installationName, message }) {
      useSessionStore().errorInstances.set(installationId, {
        installationName,
        message: message ?? `Seeded error for ${installationId}`
      })
    },
    hasErrorInstance(installationId) {
      return useSessionStore().errorInstances.has(installationId)
    },
    getInjectedApiCallCount(installationId) {
      return injectedApiCallCounts.get(installationId) ?? 0
    },
    async startInFlightOp({
      installationId,
      title,
      opKind,
      destroysInstance,
      triggersInstanceStart
    }) {
      const b = ensureBound()
      inFlightSettlers.get(installationId)?.({ ok: false, cancelled: true })
      const pending = new Promise<ActionResult>((resolve) => {
        inFlightSettlers.set(installationId, resolve)
      })
      await b.showProgress({
        installationId,
        title: title ?? `In-flight — ${installationId}`,
        opKind: opKind ?? 'generic',
        destroysInstance: destroysInstance ?? false,
        triggersInstanceStart: triggersInstanceStart ?? false,
        apiCall: () => pending
      })
    },
    settleInFlightOp({ installationId, result }) {
      const settle = inFlightSettlers.get(installationId)
      if (!settle) return false
      inFlightSettlers.delete(installationId)
      settle(result)
      return true
    },
    runActionGuard({ installationId, actionLabel }) {
      return ensureBound().actionGuard.checkBeforeAction(installationId, actionLabel)
    }
  }
  ;(globalThis as unknown as { __e2eRenderer: E2ERendererHelpers }).__e2eRenderer = helpers
}
