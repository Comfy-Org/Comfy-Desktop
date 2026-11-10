export const INSTALL_UPDATE_GLOBAL_KEY = '*'

export interface InstallUpdateOverride {
  available: boolean
  version?: string
}

export const installUpdateOverrides = new Map<string, InstallUpdateOverride>()

export function lookupInstallUpdateOverride(
  installationId: string
): InstallUpdateOverride | undefined {
  return (
    installUpdateOverrides.get(installationId) ??
    installUpdateOverrides.get(INSTALL_UPDATE_GLOBAL_KEY)
  )
}

const ipcInvocations = new Map<string, unknown[]>()

export function recordIpcInvocation(channel: string, arg?: unknown): void {
  if (process.env['E2E'] !== '1') return
  const arr = ipcInvocations.get(channel)
  if (arr) {
    arr.push(arg)
  } else {
    ipcInvocations.set(channel, [arg])
  }
}

export function getIpcInvocations(channel: string): unknown[] {
  return ipcInvocations.get(channel)?.slice() ?? []
}

export function resetIpcInvocations(channel?: string): void {
  if (channel) ipcInvocations.delete(channel)
  else ipcInvocations.clear()
}

let launchSpawnHoldArmed = false
let launchSpawnHoldRelease: (() => void) | null = null

export function armLaunchSpawnHold(): void {
  if (launchSpawnHoldRelease !== null) {
    throw new Error('armLaunchSpawnHold: a launch is already parked at the spawn hold')
  }
  launchSpawnHoldArmed = true
}

export function releaseLaunchSpawnHold(): void {
  launchSpawnHoldArmed = false
  launchSpawnHoldRelease?.()
}

export function isLaunchSpawnHeld(): boolean {
  return launchSpawnHoldRelease !== null
}

export async function waitLaunchSpawnHold(signal: AbortSignal): Promise<void> {
  if (process.env['E2E'] !== '1' || !launchSpawnHoldArmed) return
  launchSpawnHoldArmed = false
  await new Promise<void>((resolve) => {
    const release = (): void => {
      if (launchSpawnHoldRelease === release) launchSpawnHoldRelease = null
      signal.removeEventListener('abort', release)
      resolve()
    }
    launchSpawnHoldRelease = release
    if (signal.aborted) {
      release()
      return
    }
    signal.addEventListener('abort', release, { once: true })
  })
}

const shellOpenExternalCalls: string[] = []

export function recordShellOpenExternal(url: string): void {
  if (process.env['E2E'] !== '1') return
  shellOpenExternalCalls.push(url)
}

export function getShellOpenExternalCalls(): string[] {
  return shellOpenExternalCalls.slice()
}

export function resetShellOpenExternalCalls(): void {
  shellOpenExternalCalls.length = 0
}
