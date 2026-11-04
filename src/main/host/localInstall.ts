import type { ComfyWindowEntry } from './registry'

/**
 * The host shows an attached install that Desktop runs on this machine. A Remote
 * Connection, Cloud, an unknown source, or a preview host that carries a category
 * without an install is not local.
 */
export function isLocalInstall(
  entry: ComfyWindowEntry | null | undefined
): entry is ComfyWindowEntry & { installationId: string } {
  return !!entry?.installationId && entry.sourceCategory === 'local'
}
