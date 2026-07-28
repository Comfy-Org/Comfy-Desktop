// In-memory E2E overrides that bypass production data paths; empty in prod.
// Separate module so production code can consult the map without pulling in
// the rest of the E2E scaffolding.

/** Sentinel key for "apply this override to every installationId". */
export const INSTALL_UPDATE_GLOBAL_KEY = '*'

export interface InstallUpdateOverride {
  available: boolean
  version?: string
}

export const installUpdateOverrides = new Map<string, InstallUpdateOverride>()

export function lookupInstallUpdateOverride(installationId: string): InstallUpdateOverride | undefined {
  return installUpdateOverrides.get(installationId) ?? installUpdateOverrides.get(INSTALL_UPDATE_GLOBAL_KEY)
}

// IPC invocation log (E2E only) so tests can assert a fast-path skipped a
// costly IPC, e.g. Delete should not call `get-detail-sections`.
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

// Launch-spawn hold (E2E only): parks the NEXT launch right before it spawns
// the ComfyUI process - AFTER the launching marker and port reservation, so
// the picker already reads the install as launching (CTA "Restart") but no
// real process exists yet. Lets tests exercise restart-during-boot
// deterministically instead of racing real boot speed. One-shot: consumed by
// the first launch that reaches the hold; released by that launch's abort
// firing (the restart path) or by an explicit release.
let launchSpawnHoldArmed = false
let launchSpawnHoldRelease: (() => void) | null = null

export function armLaunchSpawnHold(): void {
  // Re-arming while a launch is parked would orphan the parked waiter's
  // resolver; that is always a test bug, so fail loudly.
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

/** Awaited by `tryLaunch` immediately before spawning ComfyUI. No-op in
 *  production and when not armed. Resolves when the launch's abort signal
 *  fires or the hold is released. */
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

// shell.openExternal URLs (E2E only); tests assert this stays empty to prove a
// download was captured by the session handler instead of the OS browser.
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
