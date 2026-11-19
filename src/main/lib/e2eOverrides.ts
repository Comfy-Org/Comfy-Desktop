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

interface LaunchHold {
  arm: () => void
  release: () => void
  isHeld: () => boolean
  wait: (signal: AbortSignal) => Promise<void>
}

function createLaunchHold(point: string): LaunchHold {
  let armed = false
  let releaseParkedLaunch: (() => void) | null = null
  return {
    arm() {
      if (releaseParkedLaunch !== null) {
        throw new Error(`a launch is already parked at the ${point} hold`)
      }
      armed = true
    },
    release() {
      armed = false
      releaseParkedLaunch?.()
    },
    isHeld: () => releaseParkedLaunch !== null,
    async wait(signal) {
      if (process.env['E2E'] !== '1' || !armed) return
      armed = false
      await new Promise<void>((resolve) => {
        const release = (): void => {
          if (releaseParkedLaunch === release) releaseParkedLaunch = null
          signal.removeEventListener('abort', release)
          resolve()
        }
        releaseParkedLaunch = release
        if (signal.aborted) {
          release()
          return
        }
        signal.addEventListener('abort', release, { once: true })
      })
    }
  }
}

export const {
  arm: armLaunchSpawnHold,
  release: releaseLaunchSpawnHold,
  isHeld: isLaunchSpawnHeld,
  wait: waitLaunchSpawnHold
} = createLaunchHold('spawn')

export const {
  arm: armLaunchReadyHold,
  release: releaseLaunchReadyHold,
  isHeld: isLaunchReadyHeld,
  wait: waitLaunchReadyHold
} = createLaunchHold('ready')

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
