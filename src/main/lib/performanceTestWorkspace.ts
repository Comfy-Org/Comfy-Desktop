import fs from 'fs'
import path from 'path'

/** Runtime session keys the Performance Test view launches under, one per installation. */
export const PERFORMANCE_TEST_SESSION_PREFIX = 'performance-test:'

export type SessionKind = 'performance_test' | 'normal'
/** `temp_file`: a Performance Test on its own throwaway database. `file`: anything else (the
 *  install's database, a user's own `--database-url`, or a Core with no database at all). */
export type DbMode = 'temp_file' | 'file'

export function performanceTestSessionKey(installationId: string): string {
  return `${PERFORMANCE_TEST_SESSION_PREFIX}${installationId}`
}

export function sessionKindOf(sessionKey: string): SessionKind {
  return sessionKey.startsWith(PERFORMANCE_TEST_SESSION_PREFIX) ? 'performance_test' : 'normal'
}

/**
 * Whether the Core about to be launched has a database at all, and so the flags a workspace
 * needs. The database and `--database-url` arrived together (Core v0.3.41); an older Core has
 * neither and would reject the flag.
 */
export function coreHasDatabase(comfyuiDir: string): boolean {
  return fs.existsSync(path.join(comfyuiDir, 'app', 'database', 'db.py'))
}

/** The throwaway directory a Performance Test of this install runs in: its database, outputs
 *  and temp files. One per install, under a per-user `baseDir`; a second Performance Test of
 *  the same install is refused before it gets here. */
export function performanceTestWorkspace(baseDir: string, installationId: string): string {
  return path.join(baseDir, 'perf-test', installationId.replace(/[^A-Za-z0-9_-]/g, '_'))
}

/** Delete a workspace. Best effort: a file still held open (Windows) is left for the next
 *  Performance Test of the install to remove. */
export function removePerformanceTestWorkspace(workspace: string): void {
  try {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {
    // retried before the next Performance Test of this install
  }
}

/**
 * Remove a workspace now and, while anything in it is still held (Windows releases an exited
 * process's files a moment late), retry for a few seconds. Stops as soon as `stillOwned()` is
 * false: a new run of the install has started and resets the workspace itself.
 */
export async function removePerformanceTestWorkspaceSoon(
  workspace: string,
  stillOwned: () => boolean,
  delayMs = 500,
  attempts = 10
): Promise<void> {
  removePerformanceTestWorkspace(workspace)
  for (let i = 0; i < attempts && fs.existsSync(workspace); i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (!stillOwned()) return
    removePerformanceTestWorkspace(workspace)
  }
}

/**
 * `args` pointed at the workspace: its own database, so the install's is never opened; its own
 * output folder, so each prompt's output rescan walks a few files rather than the user's whole
 * library; its own temp folder, which Core clears at startup. Every earlier value of those flags
 * is dropped rather than overridden: Core's argparse takes the last value but Desktop's own
 * readers take the first, and they must agree.
 */
export function withPerformanceTestWorkspace(args: readonly string[], workspace: string): string[] {
  const flags = {
    '--database-url': `sqlite:///${path.join(workspace, 'comfyui.db')}`,
    '--output-directory': path.join(workspace, 'output'),
    // Core appends `temp` itself.
    '--temp-directory': workspace
  }
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    const flag = Object.keys(flags).find((f) => a === f || a.startsWith(`${f}=`))
    if (!flag) out.push(a)
    else if (a === flag) i++
  }
  for (const [flag, value] of Object.entries(flags)) out.push(flag, value)
  return out
}
