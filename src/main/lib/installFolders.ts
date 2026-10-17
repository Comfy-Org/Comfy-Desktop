import path from 'path'
import * as settings from '../settings'
import type { InstallationRecord } from '../installations'
import type { LaunchCommand } from '../types/sources'
import { isSamePath, resolveComfyDir } from './models'
import type { ResolvedExtraPath } from './models'
import { resolveDownloadContext } from './modelDownloadPaths'

/** The folders an install's ComfyUI reads and writes. */
export interface InstallFolders {
  /** ComfyUI's user directory (`--user-directory`). */
  user: string
  /** Saved workflows of the default user. */
  workflows: string
  customNodes: string
  input: string
  output: string
  /** Model roots, each with a `<type>/` layout. */
  modelRoots: string[]
  /** Per-type model folders from the install's `extra_model_paths.yaml`. */
  extraModelPaths: ResolvedExtraPath[]
}

/** The shared input/output folders launch passes, or none to keep ComfyUI's own. */
interface StorageIoDirs {
  input?: string
  output?: string
}

/**
 * Where launch points ComfyUI's input and output. Each is a per-install choice:
 * the shared folder from Desktop Settings (the default), or the install's own
 * folder when it opts out. An opted-out install without its own folder keeps
 * ComfyUI's default (`<base>/{input,output}`). Sources that manage their own
 * launch (`skipSharedPaths`) get neither.
 */
export function storageIoDirs(inst: InstallationRecord, launchCmd: LaunchCommand): StorageIoDirs {
  if (launchCmd.skipSharedPaths || !launchCmd.args) return {}
  const useSharedInput = (inst.useSharedInput as boolean | undefined) !== false
  const useSharedOutput = (inst.useSharedOutput as boolean | undefined) !== false
  return {
    input: useSharedInput
      ? (settings.get('inputDir') as string | undefined) || settings.defaults.inputDir
      : (inst.inputDir as string | undefined) || undefined,
    output: useSharedOutput
      ? (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
      : (inst.outputDir as string | undefined) || undefined
  }
}

/** A flag's value as Python's argparse reads it: the last occurrence wins. */
function lastArgValue(args: readonly string[], flag: string): string | undefined {
  let value: string | undefined
  args.forEach((arg, i) => {
    if (arg === flag) value = args[i + 1]
    else if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1)
  })
  return value
}

/**
 * The folders an install's ComfyUI uses, decided the way launch decides them:
 * from the source's own launch command (adopted installs pin `--base-directory`
 * and `--user-directory` there, and users can set them in their launch
 * arguments), then the storage folders launch appends, then the model folders
 * downloads already use. `launchCmd` is `null` when the install cannot launch
 * yet; ComfyUI's defaults inside the install apply then.
 */
export function resolveInstallFolders(
  inst: InstallationRecord,
  launchCmd: LaunchCommand | null
): InstallFolders {
  // ComfyUI's own folder is where the `main.py` it runs lives.
  const script = launchCmd?.args?.find((arg) => path.basename(arg) === 'main.py')
  const comfyDir = script
    ? path.dirname(path.resolve(launchCmd?.cwd ?? inst.installPath, script))
    : resolveComfyDir(inst.installPath)
  const cwd = launchCmd?.cwd ?? comfyDir
  const io = launchCmd ? storageIoDirs(inst, launchCmd) : {}
  const args = [
    ...(launchCmd?.args ?? []),
    ...(io.input ? ['--input-directory', io.input] : []),
    ...(io.output ? ['--output-directory', io.output] : [])
  ]
  const folder = (flag: string): string | undefined => {
    const value = lastArgValue(args, flag)
    return value ? path.resolve(cwd, value) : undefined
  }

  const base = folder('--base-directory') ?? comfyDir
  const user = folder('--user-directory') ?? path.join(base, 'user')
  const { modelRoots, extraPaths } = resolveDownloadContext(inst)
  // ComfyUI reads `<base>/models` and the shared roots launch adds, which a
  // source managing its own launch does not get. With `--base-directory`
  // elsewhere, the install's own models folder is not read.
  const baseModels = path.join(base, 'models')
  const ownModels = path.join(comfyDir, 'models')
  const sharedRoots = launchCmd?.skipSharedPaths
    ? []
    : modelRoots.filter((root) => !isSamePath(root, ownModels) && !isSamePath(root, baseModels))
  return {
    user,
    workflows: path.join(user, 'default', 'workflows'),
    customNodes: path.join(base, 'custom_nodes'),
    input: folder('--input-directory') ?? path.join(base, 'input'),
    output: folder('--output-directory') ?? path.join(base, 'output'),
    modelRoots: [baseModels, ...sharedRoots],
    extraModelPaths: extraPaths
  }
}
