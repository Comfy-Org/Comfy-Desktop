import type { InstallationRecord } from '../installations'

/**
 * Resolve the comfyView session partition an install must be loaded
 * into. Unique-partition installs (`browserPartition === 'unique'`)
 * get their own `persist:${id}` bucket so cookies / IndexedDB /
 * Service Workers don't leak across sibling installs; everything
 * else shares `persist:shared`.
 *
 * Lives in its own dependency-free module (rather than
 * `createHostWindow.ts`, which re-exports it) so headless consumers
 * like `comfyDownloadManager` can resolve an install's session
 * without importing the window machinery (which itself imports the
 * download manager - a cycle).
 */
export function expectedPartitionFor(installation: InstallationRecord): string {
  return (installation.browserPartition as string | undefined) === 'unique'
    ? `persist:${installation.id}`
    : 'persist:shared'
}
