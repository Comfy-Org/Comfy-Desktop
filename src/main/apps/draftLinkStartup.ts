import { createHash } from 'crypto'
import path from 'path'

export const DEV_APP_BUNDLE_ENV = 'COMFY_DEV_APP_BUNDLE'

const DEV_COPY_LOCK_DIR = 'dev-copy-lock'
const DEV_COPY_LOCK_KEY_LENGTH = 16

export type InstanceLock = 'app' | 'dev-copy' | 'none'
export type LinkRegistration = 'scheme' | 'scheme-with-command' | 'remove-own-command' | 'none'

export interface DraftLinkStartupInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  startupLink: string | null
}

export interface DraftLinkStartup {
  lock: InstanceLock
  registration: LinkRegistration
  linkWithoutDevServer: boolean
}

export function planDraftLinkStartup({
  isPackaged,
  platform,
  env,
  startupLink
}: DraftLinkStartupInput): DraftLinkStartup {
  if (isPackaged) return { lock: 'app', registration: 'scheme', linkWithoutDevServer: false }
  if (env['E2E'] === '1') return { lock: 'none', registration: 'none', linkWithoutDevServer: false }
  if (env['COMFY_DRAFT_APP_LINKS'] === '0') {
    return {
      lock: 'none',
      registration: platform === 'win32' ? 'remove-own-command' : 'none',
      linkWithoutDevServer: false
    }
  }
  const linkWithoutDevServer = startupLink !== null && !env['ELECTRON_RENDERER_URL']
  if (platform === 'darwin') {
    return {
      lock: 'dev-copy',
      registration: env[DEV_APP_BUNDLE_ENV] ? 'scheme' : 'none',
      linkWithoutDevServer
    }
  }
  return { lock: 'dev-copy', registration: 'scheme-with-command', linkWithoutDevServer }
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
