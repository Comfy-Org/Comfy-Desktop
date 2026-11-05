import process from 'node:process'

export function isBackgroundRun(): boolean {
  return process.platform === 'win32' && !process.env['CI'] && process.env['E2E_FOREGROUND'] !== '1'
}

export const FOREGROUND_PROJECTS: readonly string[] = ['windows-focus', 'lifecycle']
