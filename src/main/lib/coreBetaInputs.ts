/** Cheap, synchronous Core beta facts, shared by the launch and the settings preview. */
import path from 'path'
import { gitDirPresence, readGitHead, resolveGitDir } from './git'
import { coreGateVersion, coreRecordCurrent } from './version'
import type { CoreCheckout } from './version'
import type { CoreVersionState } from './coreBetaGrants'
import type { InstallationRecord } from '../installations'
import type { LaunchCommand } from '../types/sources'

/** Establish what the launching checkout is, failing closed at every step, because each step
 *  has an absence meaning "we could not look" alongside the one meaning "there is nothing here".
 *  Exactly one state is the latter: no `.git` entry at all, i.e. the standalone/archive install
 *  with nothing to contradict the record. A `.git` that cannot be stat-ed, one that yields no
 *  git directory (a worktree/submodule pointer missing its `gitdir:` line), and a git directory
 *  whose HEAD would not read are all git-managed checkouts we failed to inspect.
 *  {@link coreRecordCurrent} grants on `not-git` and refuses `unreadable`, so collapsing any of
 *  the three into it — as a bare `readGitHead` call does, and as a bare `resolveGitDir(…) ===
 *  null` test does one layer below that — is what made the gate fail open. */
export function resolveCoreCheckout(comfyuiDir: string): CoreCheckout {
  switch (gitDirPresence(comfyuiDir)) {
    case 'absent':
      return { kind: 'not-git' }
    case 'indeterminate':
      return { kind: 'unreadable' }
    case 'present': {
      if (resolveGitDir(comfyuiDir) === null) return { kind: 'unreadable' }
      const head = readGitHead(comfyuiDir)
      return head === null ? { kind: 'unreadable' } : { kind: 'head', commit: head }
    }
  }
}

/** Splits Desktop's `... -s <main.py>` prefix from the user's args; `null` without that pair. */
export function splitLaunchCommand(launchCmd: Pick<LaunchCommand, 'args' | 'cwd'>): {
  prefixArgs: string[]
  userArgs: string[]
  mainPyAbs: string
  comfyuiDir: string
} | null {
  const { args, cwd } = launchCmd
  if (!args || !cwd) return null
  const sIdx = args.indexOf('-s')
  if (sIdx === -1 || sIdx + 1 >= args.length) return null
  const mainPyAbs = path.resolve(cwd, args[sIdx + 1]!)
  return {
    prefixArgs: args.slice(0, sIdx + 2),
    userArgs: args.slice(sIdx + 2),
    mainPyAbs,
    comfyuiDir: path.dirname(mainPyAbs)
  }
}

/** The revision the args-schema cache falls back to when the checkout's HEAD cannot be read. */
export function recordedRevision(inst: InstallationRecord): string | undefined {
  return inst.comfyVersion?.commit ?? (inst.version as string | undefined)
}

/** The core release as the version gate reads it, for the checkout being launched. */
export function coreVersionState(
  inst: InstallationRecord,
  checkout: CoreCheckout
): CoreVersionState {
  return { ...coreGateVersion(inst), current: coreRecordCurrent(inst, checkout) }
}
