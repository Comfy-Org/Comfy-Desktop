import type { BrowserWindow } from 'electron'

export interface RestartLoadTarget {
  window: Pick<BrowserWindow, 'isDestroyed'>
  installationId: string | null
}

export function restartLoadAbandoned(
  entry: RestartLoadTarget,
  installationId: string,
  currentRelaunch: { token: number } | undefined,
  myToken: number | undefined
): boolean {
  if (entry.window.isDestroyed()) return true
  if (currentRelaunch && currentRelaunch.token !== myToken) return true
  return entry.installationId !== installationId
}
