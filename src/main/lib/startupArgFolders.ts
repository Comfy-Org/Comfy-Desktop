import path from 'path'
import * as settings from '../settings'
import type { InstallationRecord } from '../installations'
import { resolveComfyDir } from './models'
import { parseArgs } from './util'

export type ComfyFolderKind = 'input' | 'output'

export interface LaunchFolder {
  path: string
  shared: boolean
}

export const FOLDER_FLAG: Readonly<Record<ComfyFolderKind, string>> = {
  input: '--input-directory',
  output: '--output-directory'
}

const SOURCES_WITH_STARTUP_ARG_FOLDERS: ReadonlySet<string> = new Set(['git'])

export function usesStartupArgFolders(inst: Pick<InstallationRecord, 'sourceId'>): boolean {
  return SOURCES_WITH_STARTUP_ARG_FOLDERS.has(inst.sourceId)
}

export function lastArgValue(args: readonly string[], flag: string): string | null {
  let value: string | undefined
  for (const [i, arg] of args.entries()) {
    if (arg === flag) value = args[i + 1]
    else if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1)
  }
  return value || null
}

export function sharedFolder(
  kind: ComfyFolderKind,
  storage: Partial<Pick<settings.Settings, 'inputDir' | 'outputDir'>> = {
    inputDir: settings.get('inputDir') as string | undefined,
    outputDir: settings.get('outputDir') as string | undefined
  }
): string {
  return kind === 'input'
    ? storage.inputDir || settings.defaults.inputDir
    : storage.outputDir || settings.defaults.outputDir
}

export function comfyStartDir(inst: Pick<InstallationRecord, 'installPath'>): string {
  return resolveComfyDir(inst.installPath)
}

export function resolveFolderArg(value: string, startDir: () => string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(startDir(), value)
}

export function startupArgFolder(inst: InstallationRecord, kind: ComfyFolderKind): string | null {
  const launchArgs = typeof inst.launchArgs === 'string' ? inst.launchArgs : ''
  const value = lastArgValue(parseArgs(launchArgs), FOLDER_FLAG[kind])
  return value ? resolveFolderArg(value, () => comfyStartDir(inst)) : null
}

export function startupArgOrSharedFolder(
  inst: InstallationRecord,
  kind: ComfyFolderKind
): LaunchFolder {
  const fromArgs = startupArgFolder(inst, kind)
  return fromArgs ? { path: fromArgs, shared: false } : { path: sharedFolder(kind), shared: true }
}
