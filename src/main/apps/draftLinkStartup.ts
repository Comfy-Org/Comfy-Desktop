import { createHash } from 'crypto'
import path from 'path'

export const DEV_APP_BUNDLE_ENV = 'COMFY_DEV_APP_BUNDLE'
export const DEV_DESKTOP_ENTRY_ENV = 'COMFY_DEV_DESKTOP_ENTRY'
export const DEV_SERVER_LOCK_WAIT_MS = 5000
export const LOCK_RETRY_INTERVAL_MS = 100
export const DEV_SERVER_START_DATA = { devServerStart: true }

const DEV_COPY_LOCK_DIR = 'dev-copy-lock'
const DEV_COPY_LOCK_KEY_LENGTH = 16

export type InstanceLock = 'app' | 'dev-copy' | 'none'
export type LockTiming = 'start' | 'ready'
export type LinkRegistration =
  'scheme' | 'scheme-with-command' | 'desktop-entry' | 'remove-own-command' | 'none'

export interface DraftLinkStartupInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  startupLink: string | null
}

export interface DraftLinkStartup {
  lock: InstanceLock
  lockTiming: LockTiming
  lockWaitMs: number
  registration: LinkRegistration
  desktopEntry: string | null
  linkWithoutDevServer: boolean
}

const LINKS_OFF: DraftLinkStartup = {
  lock: 'none',
  lockTiming: 'start',
  lockWaitMs: 0,
  registration: 'none',
  desktopEntry: null,
  linkWithoutDevServer: false
}

function devCopyRegistration(
  platform: NodeJS.Platform,
  env: DraftLinkStartupInput['env']
): Pick<DraftLinkStartup, 'registration' | 'desktopEntry'> {
  if (platform === 'darwin') {
    return { registration: env[DEV_APP_BUNDLE_ENV] ? 'scheme' : 'none', desktopEntry: null }
  }
  if (platform === 'win32') return { registration: 'scheme-with-command', desktopEntry: null }
  const desktopEntry = env[DEV_DESKTOP_ENTRY_ENV] || null
  return { registration: desktopEntry ? 'desktop-entry' : 'none', desktopEntry }
}

export function planDraftLinkStartup({
  isPackaged,
  platform,
  env,
  startupLink
}: DraftLinkStartupInput): DraftLinkStartup {
  if (isPackaged) return { ...LINKS_OFF, lock: 'app', registration: 'scheme' }
  if (env['E2E'] === '1') return LINKS_OFF
  if (env['COMFY_DRAFT_APP_LINKS'] === '0') {
    return { ...LINKS_OFF, registration: platform === 'win32' ? 'remove-own-command' : 'none' }
  }
  const startedByDevServer = Boolean(env['ELECTRON_RENDERER_URL'])
  return {
    lock: 'dev-copy',
    lockTiming: startedByDevServer ? 'ready' : 'start',
    lockWaitMs: startedByDevServer ? DEV_SERVER_LOCK_WAIT_MS : 0,
    ...devCopyRegistration(platform, env),
    linkWithoutDevServer: startupLink !== null && !startedByDevServer
  }
}

export interface LockRetry {
  tryLock: () => boolean
  waitMs: number
  intervalMs: number
  now: () => number
  schedule: (attempt: () => void, ms: number) => void
  onDone: (held: boolean) => void
}

export function retryLock({ tryLock, waitMs, intervalMs, now, schedule, onDone }: LockRetry): void {
  const deadline = now() + waitMs
  const attempt = (): void => {
    if (tryLock()) return onDone(true)
    if (now() >= deadline) return onDone(false)
    schedule(attempt, intervalMs)
  }
  attempt()
}

export function isDevServerStart(additionalData: unknown): boolean {
  return (
    typeof additionalData === 'object' &&
    additionalData !== null &&
    (additionalData as Record<string, unknown>)['devServerStart'] === true
  )
}

export function devCopyLockDir(
  userData: string,
  appPath: string,
  platform: NodeJS.Platform
): string {
  const key = platform === 'win32' ? appPath.toLowerCase() : appPath
  const hash = createHash('sha256').update(key).digest('hex').slice(0, DEV_COPY_LOCK_KEY_LENGTH)
  return path.join(userData, DEV_COPY_LOCK_DIR, hash)
}
