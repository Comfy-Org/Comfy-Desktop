import process from 'node:process'

const BACKGROUND_PLATFORMS: readonly NodeJS.Platform[] = ['win32', 'darwin']

export function isBackgroundRun(): boolean {
  return (
    BACKGROUND_PLATFORMS.includes(process.platform) &&
    !process.env['CI'] &&
    process.env['E2E_FOREGROUND'] !== '1'
  )
}

export const FOREGROUND_PROJECTS: readonly string[] = ['windows-focus', 'macos-focus', 'lifecycle']
