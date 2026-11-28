import { safeStorage } from 'electron'

const WEAK_LINUX_BACKENDS: ReadonlySet<string> = new Set(['basic_text', 'unknown'])

export function keepsTokensInOsKeychain(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'linux') return true
  try {
    return !WEAK_LINUX_BACKENDS.has(safeStorage.getSelectedStorageBackend())
  } catch {
    return false
  }
}
