import path from 'path'
import { gitDirPresence, readGitHead, resolveGitDir } from './git'
import { coreGateVersion, coreRecordCurrent } from './version'
import type { CoreCheckout } from './version'
import type { CoreVersionState } from './coreBetaGrants'
import type { InstallationRecord } from '../installations'
import type { LaunchCommand } from '../types/sources'

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

export function coreVersionState(
  inst: InstallationRecord,
  checkout: CoreCheckout
): CoreVersionState {
  return { ...coreGateVersion(inst), current: coreRecordCurrent(inst, checkout) }
}
