import { defineStore } from 'pinia'
import { reactive, computed, ref } from 'vue'
import type { RunningInstance, ComfyOutputData, ComfyExitedData, CrashKind } from '../types/ipc'

interface SessionBuffer {
  output: string
  exited: boolean
}

interface ActiveSession {
  label: string
}

interface ErrorInstance {
  installationName: string
  exitCode?: number | string
  signal?: string
  message?: string
  lastStderr?: string
  exitCodeHex?: string
  crashKind?: CrashKind
  vcRuntimeMissing?: string[]
  crashedAtMs?: number
}

export const useSessionStore = defineStore('session', () => {
  const runningInstances = reactive(new Map<string, RunningInstance>())
  const launchingInstances = reactive(new Map<string, { installationName: string }>())
  const activeSessions = reactive(new Map<string, ActiveSession>())
  const errorInstances = reactive(new Map<string, ErrorInstance>())
  const stoppingInstances = reactive(new Set<string>())
  const operationInstances = reactive(new Map<string, { actionId: string }>())
  const stoppingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  const sessions = reactive(new Map<string, SessionBuffer>())

  const ready = ref(false)

  const runningTabCount = computed(() => activeSessions.size + runningInstances.size)
  const hasErrors = computed(() => errorInstances.size > 0)

  const cleanups: (() => void)[] = []

  function isRunning(installationId: string): boolean {
    return runningInstances.has(installationId)
  }

  function isLaunching(installationId: string): boolean {
    return launchingInstances.has(installationId)
  }

  function isStopping(installationId: string): boolean {
    return stoppingInstances.has(installationId)
  }

  function clearStoppingState(installationId: string): void {
    stoppingInstances.delete(installationId)
    const timeout = stoppingTimeouts.get(installationId)
    if (timeout) {
      clearTimeout(timeout)
      stoppingTimeouts.delete(installationId)
    }
  }

  function markStopping(installationId: string): void {
    stoppingInstances.add(installationId)
    const existing = stoppingTimeouts.get(installationId)
    if (existing) clearTimeout(existing)
    stoppingTimeouts.set(
      installationId,
      setTimeout(() => clearStoppingState(installationId), 30_000)
    )
  }

  function setActiveSession(installationId: string, label: string): void {
    activeSessions.set(installationId, { label: label || '' })
    errorInstances.delete(installationId)
  }

  function clearActiveSession(installationId?: string): void {
    if (installationId) {
      activeSessions.delete(installationId)
    } else {
      activeSessions.clear()
    }
  }

  function clearErrorInstance(installationId: string): void {
    errorInstances.delete(installationId)
    sessions.delete(installationId)
  }

  function startSession(installationId: string): void {
    sessions.set(installationId, { output: '', exited: false })
  }

  function getSession(installationId: string): SessionBuffer | undefined {
    return sessions.get(installationId)
  }

  function hasSession(installationId: string): boolean {
    return sessions.has(installationId)
  }

  function clearSession(installationId: string): void {
    sessions.delete(installationId)
  }

  function appendOutput(installationId: string, text: string): void {
    let session = sessions.get(installationId)
    if (!session) {
      session = { output: '', exited: false }
      sessions.set(installationId, session)
    }

    const parts = text.split(/\r(?!\n)/)
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]!
      if (i === 0) {
        session.output += segment
      } else if (segment.length > 0) {
        const lastNewline = session.output.lastIndexOf('\n')
        session.output = session.output.slice(0, lastNewline + 1) + segment
      }
    }
  }

  async function init(): Promise<void> {
    dispose()
    const instances = await window.api.getRunningInstances()
    for (const inst of instances) {
      runningInstances.set(inst.installationId, inst)
    }

    const launching = (await window.api.getLaunchingInstances?.()) ?? []
    for (const inst of launching) {
      if (!runningInstances.has(inst.installationId)) {
        launchingInstances.set(inst.installationId, { installationName: inst.installationName })
      }
    }

    const stopping = (await window.api.getStoppingInstances?.()) ?? []
    for (const id of stopping) markStopping(id)

    const activeOps = (await window.api.getActiveOperations?.()) ?? []
    for (const op of activeOps) {
      operationInstances.set(op.installationId, { actionId: op.actionId })
    }

    const crashes = (await window.api.getCrashInstances?.()) ?? []
    for (const c of crashes) {
      if (!runningInstances.has(c.installationId) && !launchingInstances.has(c.installationId)) {
        errorInstances.set(c.installationId, {
          installationName: c.installationName,
          exitCode: c.exitCode,
          signal: c.signal,
          lastStderr: c.lastStderr,
          exitCodeHex: c.exitCodeHex,
          crashKind: c.crashKind,
          vcRuntimeMissing: c.vcRuntimeMissing,
          crashedAtMs: c.crashedAtMs
        })
      }
    }

    cleanups.push(
      window.api.onInstanceLaunching(
        (data: { installationId: string; installationName: string }) => {
          launchingInstances.set(data.installationId, { installationName: data.installationName })
          errorInstances.delete(data.installationId)
        }
      ),
      window.api.onInstanceLaunchFailed((data: { installationId: string }) => {
        launchingInstances.delete(data.installationId)
      }),
      window.api.onInstanceStarted((data: RunningInstance) => {
        launchingInstances.delete(data.installationId)
        runningInstances.set(data.installationId, data)
        errorInstances.delete(data.installationId)
      }),
      window.api.onInstanceStopped((data: { installationId: string }) => {
        runningInstances.delete(data.installationId)
        clearStoppingState(data.installationId)
      }),
      window.api.onInstanceStopping((data: { installationId: string }) => {
        markStopping(data.installationId)
      }),
      window.api.onOperationChanged?.(
        (data: { installationId: string; actionId: string; active: boolean }) => {
          if (data.active) {
            operationInstances.set(data.installationId, { actionId: data.actionId })
          } else {
            operationInstances.delete(data.installationId)
          }
        }
      ) ?? ((): void => {}),
      window.api.onComfyOutput((data: ComfyOutputData) => {
        appendOutput(data.installationId, data.text)
      }),
      window.api.onComfyExited((data: ComfyExitedData) => {
        const session = sessions.get(data.installationId)
        if (session) {
          session.exited = true
          const codeLabel =
            data.exitCode != null
              ? `${data.exitCode}${data.exitCodeHex ? ` / ${data.exitCodeHex}` : ''}`
              : 'unknown'
          const msg = data.crashed ? `Process crashed (exit code ${codeLabel})` : 'Process exited'
          session.output += `\n\n--- ${msg} ---\n`
        }
      }),
      window.api.onInstanceCrashed((data: ComfyExitedData) => {
        errorInstances.set(data.installationId, {
          installationName: data.installationName,
          exitCode: data.exitCode,
          signal: data.signal,
          lastStderr: data.lastStderr,
          exitCodeHex: data.exitCodeHex,
          crashKind: data.crashKind,
          vcRuntimeMissing: data.vcRuntimeMissing,
          crashedAtMs: data.crashedAtMs ?? Date.now()
        })
      })
    )

    ready.value = true
  }

  function dispose(): void {
    for (const fn of cleanups) fn()
    cleanups.length = 0
    for (const timeout of stoppingTimeouts.values()) clearTimeout(timeout)
    stoppingTimeouts.clear()
    ready.value = false
  }

  return {
    runningInstances,
    launchingInstances,
    activeSessions,
    errorInstances,
    operationInstances,
    sessions,
    ready,
    runningTabCount,
    hasErrors,
    isRunning,
    isLaunching,
    stoppingInstances,
    isStopping,
    setActiveSession,
    clearActiveSession,
    clearErrorInstance,
    startSession,
    getSession,
    hasSession,
    clearSession,
    appendOutput,
    init,
    dispose
  }
})
