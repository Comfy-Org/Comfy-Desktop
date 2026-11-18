import type { QueueAnswer } from './comfyProcessRecord'

export const IDLE_UPDATE_QUIET_MS = 30 * 60 * 1000
const IDLE_UPDATE_TICK_MS = 60 * 1000

export interface IdleSession {
  installationId: string
  port: number
  startedAt: number
}

export interface IdleUpdateDeps {
  now: () => number
  runningSessions: () => IdleSession[]
  probeQueue: (port: number) => Promise<QueueAnswer>
  instanceUpdateChannel: (installationId: string) => Promise<string | null>
  updateInstance: (installationId: string, channel: string) => void
  appUpdateWaiting: () => boolean
  installAppUpdate: () => void
}

export interface IdleUpdateWatcher {
  noteInput: (installationId: string | null) => void
  tick: () => Promise<void>
  stop: () => void
}

function queueIsEmpty(answer: QueueAnswer): boolean {
  return answer !== null && answer !== 'not_queue' && answer.running + answer.pending === 0
}

export function createIdleUpdateWatcher(
  deps: IdleUpdateDeps,
  options: { tickMs?: number; quietMs?: number } = {}
): IdleUpdateWatcher {
  const quietMs = options.quietMs ?? IDLE_UPDATE_QUIET_MS
  const lastActivity = new Map<string, number>()
  let lastInputAnywhere = deps.now()
  let ticking = false
  let appInstallRequested = false

  function noteInput(installationId: string | null): void {
    const now = deps.now()
    lastInputAnywhere = now
    if (installationId) lastActivity.set(installationId, now)
  }

  async function sessionIsQuiet(session: IdleSession, now: number): Promise<boolean> {
    if (!queueIsEmpty(await deps.probeQueue(session.port))) {
      lastActivity.set(session.installationId, now)
    }
    const quietSince = Math.max(session.startedAt, lastActivity.get(session.installationId) ?? 0)
    return now - quietSince >= quietMs
  }

  async function tick(): Promise<void> {
    if (ticking || appInstallRequested) return
    ticking = true
    try {
      const now = deps.now()
      let everythingQuiet = now - lastInputAnywhere >= quietMs
      for (const session of deps.runningSessions()) {
        if (!(await sessionIsQuiet(session, now))) {
          everythingQuiet = false
          continue
        }
        const channel = await deps.instanceUpdateChannel(session.installationId)
        if (channel) {
          lastActivity.set(session.installationId, now)
          everythingQuiet = false
          deps.updateInstance(session.installationId, channel)
        }
      }
      if (everythingQuiet && deps.appUpdateWaiting()) {
        appInstallRequested = true
        deps.installAppUpdate()
      }
    } finally {
      ticking = false
    }
  }

  const timer = setInterval(() => {
    void tick().catch((err: unknown) => console.warn('[idle-update] tick failed:', err))
  }, options.tickMs ?? IDLE_UPDATE_TICK_MS)
  timer.unref?.()

  return { noteInput, tick, stop: () => clearInterval(timer) }
}
