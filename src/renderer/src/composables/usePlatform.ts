export type RendererPlatform = 'mac' | 'windows' | 'linux' | 'unknown'

export function normalizePlatform(platform: string | undefined | null): RendererPlatform {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return 'unknown'
}

export function revealInFolderKey(platform: string | undefined | null): string {
  switch (normalizePlatform(platform)) {
    case 'mac':
      return 'assets.local.showInFinder'
    case 'windows':
      return 'assets.local.showInExplorer'
    default:
      return 'assets.showInFolder'
  }
}

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
