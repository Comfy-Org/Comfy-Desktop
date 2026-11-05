import process from 'node:process'

/**
 * Whether this run keeps Electron windows from taking OS focus. Windows only, because that is
 * the only platform the `@needs-focus` list has been measured on. CI keeps the real behaviour,
 * as does `E2E_FOREGROUND=1`.
 */
export function isBackgroundRun(): boolean {
  return process.platform === 'win32' && !process.env['CI'] && process.env['E2E_FOREGROUND'] !== '1'
}

/**
 * Projects that always launch with real focus behaviour, even in a background run:
 * `windows-focus` holds the tests that need OS focus, and the lifecycle zero-mock policy
 * forbids patching Electron APIs.
 */
export const FOREGROUND_PROJECTS: readonly string[] = ['windows-focus', 'lifecycle']
