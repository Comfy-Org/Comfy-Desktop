// OS-aware copy helpers for the renderer.

export type RendererPlatform = 'mac' | 'windows' | 'linux' | 'unknown'

/** Map a Node `process.platform` string (as exposed via `window.api.platform`)
 *  to the renderer's coarse OS bucket. */
export function normalizePlatform(platform: string | undefined | null): RendererPlatform {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return 'unknown'
}

/** Label for the "open the file's enclosing folder" action, per OS. */
export function revealInFolderLabel(platform: string | undefined | null): string {
  switch (normalizePlatform(platform)) {
    case 'mac':
      return 'Show in Finder'
    case 'windows':
      return 'Show in Explorer'
    case 'linux':
      return 'Show in Folder'
    default:
      return 'Open Folder'
  }
}
