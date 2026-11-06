
import type { ElectronApplication } from 'playwright'
import { evalWithRetry } from './evalRetry'

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface DownloadProgressLike {
  url: string
  filename: string
  directory?: string
  savePath?: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  status: DownloadStatus
  error?: string
  createdAt?: number
}

export interface DownloadsTrayStateLike {
  active: DownloadProgressLike[]
  recent: DownloadProgressLike[]
}

export interface AppUpdateStateLike {
  kind: 'available' | 'downloading' | 'ready' | null
  version: string | null
  autoUpdate: boolean
}

export interface PopupBoundsResult {
  kind: 'menu' | 'downloads'
  bounds: { x: number; y: number; width: number; height: number }
}

export async function seedDownloads(
  app: ElectronApplication,
  snapshot: DownloadsTrayStateLike,
): Promise<void> {
  await evalWithRetry(() => app.evaluate((_electron, s) => {
    const helpers = (globalThis as unknown as { __e2e?: { seedDownloads: (s: unknown) => void } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.seedDownloads(s)
  }, snapshot))
}

export async function getLiveDownloadsTrayState(
  app: ElectronApplication,
): Promise<DownloadsTrayStateLike> {
  return evalWithRetry(() => app.evaluate((_electron) => {
    const helpers = (globalThis as unknown as { __e2e?: { getDownloadsTrayState: () => unknown } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.getDownloadsTrayState() as { active: unknown[]; recent: unknown[] }
  })) as Promise<DownloadsTrayStateLike>
}

export async function setInstallUpdate(
  app: ElectronApplication,
  opts: { installationId?: string; available: boolean; version?: string },
): Promise<void> {
  await evalWithRetry(() => app.evaluate((_electron, o) => {
    const helpers = (globalThis as unknown as { __e2e?: { setInstallUpdate: (o: unknown) => void } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.setInstallUpdate(o)
  }, opts))
}

export async function setAppUpdateState(
  app: ElectronApplication,
  state: AppUpdateStateLike,
): Promise<void> {
  await evalWithRetry(() => app.evaluate((_electron, s) => {
    const helpers = (globalThis as unknown as { __e2e?: { setAppUpdateState: (s: unknown) => void } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.setAppUpdateState(s)
  }, state))
}

export async function getTitlePopupBounds(
  app: ElectronApplication,
): Promise<PopupBoundsResult | null> {
  return await evalWithRetry(() => app.evaluate(() => {
    const helpers = (globalThis as unknown as { __e2e?: { getTitlePopupBounds: () => unknown } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.getTitlePopupBounds() as PopupBoundsResult | null
  }))
}

export async function returnFirstInstallHostToDashboard(
  app: ElectronApplication,
): Promise<number | null> {
  return await evalWithRetry(() => app.evaluate(async () => {
    const helpers = (globalThis as unknown as {
      __e2e?: { returnFirstInstallHostToDashboard: () => Promise<number | null> }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.returnFirstInstallHostToDashboard()
  }))
}

export async function getIpcInvocations(
  app: ElectronApplication,
  channel: string,
): Promise<unknown[]> {
  return await evalWithRetry(() => app.evaluate((_electron, c) => {
    const helpers = (globalThis as unknown as { __e2e?: { getIpcInvocations: (c: string) => unknown[] } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.getIpcInvocations(c)
  }, channel))
}

export async function resetIpcInvocations(
  app: ElectronApplication,
  channel?: string,
): Promise<void> {
  await evalWithRetry(() => app.evaluate((_electron, c) => {
    const helpers = (globalThis as unknown as { __e2e?: { resetIpcInvocations: (c?: string) => void } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.resetIpcInvocations(c)
  }, channel))
}

export async function getShellOpenExternalCalls(
  app: ElectronApplication,
): Promise<string[]> {
  return await evalWithRetry(() => app.evaluate(() => {
    const helpers = (globalThis as unknown as { __e2e?: { getShellOpenExternalCalls: () => string[] } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.getShellOpenExternalCalls()
  }))
}

export async function resetShellOpenExternalCalls(app: ElectronApplication): Promise<void> {
  await evalWithRetry(() => app.evaluate(() => {
    const helpers = (globalThis as unknown as { __e2e?: { resetShellOpenExternalCalls: () => void } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.resetShellOpenExternalCalls()
  }))
}

export async function seedRunningSession(
  app: ElectronApplication,
  opts: {
    installationId: string
    installationName: string
    coreBetaArgs?: { arg: string; name: string | null }[]
  },
): Promise<void> {
  await evalWithRetry(() => app.evaluate((_electron, o) => {
    const helpers = (globalThis as unknown as {
      __e2e?: { seedRunningSession: (o: unknown) => void }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.seedRunningSession(o)
  }, opts))
}

export async function ensureInstallPanelView(
  app: ElectronApplication,
  installationId: string,
): Promise<boolean> {
  return await evalWithRetry(() => app.evaluate((_electron, id) => {
    const helpers = (globalThis as unknown as {
      __e2e?: { ensureInstallPanelView: (id: string) => boolean }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.ensureInstallPanelView(id)
  }, installationId))
}

export async function ageReleaseCache(
  app: ElectronApplication,
  maxCheckedAt: number,
): Promise<void> {
  await evalWithRetry(() => app.evaluate((_electron, ts) => {
    const helpers = (globalThis as unknown as { __e2e?: { ageReleaseCache: (ts: number) => void } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.ageReleaseCache(ts)
  }, maxCheckedAt))
}

export async function clearRunningSessions(app: ElectronApplication): Promise<void> {
  await evalWithRetry(() => app.evaluate(() => {
    const helpers = (globalThis as unknown as { __e2e?: { clearRunningSessions: () => void } }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.clearRunningSessions()
  }))
}

export interface RunningSessionSnapshotLike {
  pid: number | null
  startedAt: number
  port: number
  url: string | undefined
}

export async function getRunningSessionSnapshot(
  app: ElectronApplication,
  installationId: string,
): Promise<RunningSessionSnapshotLike | null> {
  return await evalWithRetry(() => app.evaluate((_electron, id) => {
    const helpers = (globalThis as unknown as {
      __e2e?: { getRunningSessionSnapshot: (id: string) => unknown }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.getRunningSessionSnapshot(id) as RunningSessionSnapshotLike | null
  }, installationId))
}

export async function hasActiveOperation(
  app: ElectronApplication,
  installationId: string,
): Promise<boolean> {
  return await evalWithRetry(() => app.evaluate((_electron, id) => {
    const helpers = (globalThis as unknown as {
      __e2e?: { hasActiveOperation: (id: string) => boolean }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.hasActiveOperation(id)
  }, installationId))
}

export async function isInstallLaunching(
  app: ElectronApplication,
  installationId: string,
): Promise<boolean> {
  return await evalWithRetry(() => app.evaluate((_electron, id) => {
    const helpers = (globalThis as unknown as {
      __e2e?: { isLaunching: (id: string) => boolean }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.isLaunching(id)
  }, installationId))
}

export async function hasActiveLaunch(
  app: ElectronApplication,
  installationId: string,
): Promise<boolean> {
  return await evalWithRetry(() => app.evaluate((_electron, id) => {
    const helpers = (globalThis as unknown as {
      __e2e?: { hasActiveLaunch: (id: string) => boolean }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.hasActiveLaunch(id)
  }, installationId))
}

export async function armLaunchSpawnHold(app: ElectronApplication): Promise<void> {
  await evalWithRetry(() => app.evaluate(() => {
    const helpers = (globalThis as unknown as {
      __e2e?: { armLaunchSpawnHold: () => void }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.armLaunchSpawnHold()
  }))
}

export async function releaseLaunchSpawnHold(app: ElectronApplication): Promise<void> {
  await evalWithRetry(() => app.evaluate(() => {
    const helpers = (globalThis as unknown as {
      __e2e?: { releaseLaunchSpawnHold: () => void }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    helpers.releaseLaunchSpawnHold()
  }))
}

export async function isLaunchSpawnHeld(app: ElectronApplication): Promise<boolean> {
  return await evalWithRetry(() => app.evaluate(() => {
    const helpers = (globalThis as unknown as {
      __e2e?: { isLaunchSpawnHeld: () => boolean }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.isLaunchSpawnHeld()
  }))
}

export async function getReleaseCacheCheckedAt(
  app: ElectronApplication,
  repo: string,
  channel: string,
): Promise<number | null> {
  return await evalWithRetry(() => app.evaluate((_electron, args) => {
    const helpers = (globalThis as unknown as {
      __e2e?: { getReleaseCacheCheckedAt: (r: string, c: string) => number | null }
    }).__e2e
    if (!helpers) throw new Error('E2E helpers not registered (process.env.E2E !== "1"?)')
    return helpers.getReleaseCacheCheckedAt(args.repo, args.channel)
  }, { repo, channel }))
}
