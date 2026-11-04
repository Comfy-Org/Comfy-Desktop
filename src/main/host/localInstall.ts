import type { ComfyWindowEntry } from './registry'

export function isLocalInstall(
  entry: ComfyWindowEntry | null | undefined
): entry is ComfyWindowEntry & { installationId: string } {
  return !!entry?.installationId && entry.sourceCategory === 'local'
}
