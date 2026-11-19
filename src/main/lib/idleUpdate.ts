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
  const updateRequested = new Set<string>()
  let lastInputAnywhere = deps.now()
  let ticking = false
  let appInstallRequested = false

  function noteActivity(installationId: string, at: number): void {
    lastActivity.set(installationId, at)
    updateRequested.delete(installationId)
    appInstallRequested = false
  }

  function noteInput(installationId: string | null): void {
    const now = deps.now()
    lastInputAnywhere = now
    appInstallRequested = false
    if (installationId) noteActivity(installationId, now)
  }

  async function sessionIsQuiet(session: IdleSession, now: number): Promise<boolean> {
    if (!queueIsEmpty(await deps.probeQueue(session.port))) {
      noteActivity(session.installationId, now)
    }
    const quietSince = Math.max(session.startedAt, lastActivity.get(session.installationId) ?? 0)
    return now - quietSince >= quietMs
  }

  async function requestInstanceUpdate(session: IdleSession): Promise<boolean> {
    const id = session.installationId
    if (updateRequested.has(id)) return false
    const activityBefore = lastActivity.get(id)
    const channel = await deps.instanceUpdateChannel(id)
    if (!channel || lastActivity.get(id) !== activityBefore) return false
    updateRequested.add(id)
    deps.updateInstance(id, channel)
    return true
  }

  async function tick(): Promise<void> {
    if (ticking) return
    ticking = true
    try {
      const now = deps.now()
      let everythingQuiet = true
      for (const session of deps.runningSessions()) {
        if (!(await sessionIsQuiet(session, now)) || (await requestInstanceUpdate(session))) {
          everythingQuiet = false
        }
      }
      if (
        everythingQuiet &&
        !appInstallRequested &&
        deps.now() - lastInputAnywhere >= quietMs &&
        deps.appUpdateWaiting()
      ) {
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
