import path from 'path'
import type { InstallationRecord } from '../installations'
import { installInputDir, installOutputDir } from './models'
import {
  sharedFolder,
  startupArgOrSharedFolder,
  usesStartupArgFolders,
  type ComfyFolderKind,
  type LaunchFolder
} from './startupArgFolders'
import type { SessionInfo } from './ipc/runningSessions'

export interface EffectiveFolder extends LaunchFolder {
  nextStartPath: string
}

function samePath(a: string, b: string): boolean {
  const key = (p: string): string => {
    const resolved = path.resolve(p)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return key(a) === key(b)
}

function ownFolderOf(inst: InstallationRecord, kind: ComfyFolderKind): string {
  return kind === 'input'
    ? (inst.inputDir as string | undefined) || installInputDir(inst.installPath)
    : (inst.outputDir as string | undefined) || installOutputDir(inst.installPath)
}

const SHARING_SWITCH: Readonly<Record<ComfyFolderKind, 'useSharedInput' | 'useSharedOutput'>> = {
  input: 'useSharedInput',
  output: 'useSharedOutput'
}

function savedFolderOf(inst: InstallationRecord, kind: ComfyFolderKind): LaunchFolder {
  if (usesStartupArgFolders(inst)) return startupArgOrSharedFolder(inst, kind)
  if ((inst[SHARING_SWITCH[kind]] as boolean | undefined) !== false) {
    return { path: sharedFolder(kind), shared: true }
  }
  return { path: ownFolderOf(inst, kind), shared: false }
}

export function effectiveFolderOf(
  inst: InstallationRecord,
  kind: ComfyFolderKind,
  running: Pick<SessionInfo, 'launchFolders'> | undefined
): EffectiveFolder | null {
  const saved = savedFolderOf(inst, kind)
  if (!running) return { ...saved, nextStartPath: saved.path }
  const launched = running.launchFolders?.[kind]
  if (!launched) return null
  return {
    path: launched,
    shared: samePath(launched, sharedFolder(kind)),
    nextStartPath: saved.path
  }
}
