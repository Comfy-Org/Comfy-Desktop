import path from 'path'
import type { WebContents } from 'electron'

import type { AppOutput, AppOutputs } from '../../types/ipc'
import * as installations from '../installations'
import { comfyOutputPath } from '../lib/outputFolders'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { pageBuildId } from './localComfy'
import type { ComfyOutputFile, OutputRequest } from './outputRequest'

const FILES_AT_ONCE = 4

export type FindOutputFile = (file: ComfyOutputFile, bytes: Uint8Array) => Promise<string | null>

export interface LocatedOutputs {
  outputs: AppOutputs
  files: (string | null)[]
}

export async function locateOutputFiles(
  request: OutputRequest,
  find: FindOutputFile
): Promise<LocatedOutputs> {
  const files: (string | null)[] = request.items.map(() => null)
  await runPool(request.items, FILES_AT_ONCE, async (item, i) => {
    if (item.comfyFile) files[i] = await find(item.comfyFile, item.bytes).catch(() => null)
  })
  const items = request.items.map(({ comfyFile, folder, ...output }, i): AppOutput => {
    const file = files[i]
    if (file) return { ...output, folder: path.dirname(file), filePath: file }
    return folder && !comfyFile ? { ...output, folder } : output
  })
  return { outputs: { items, index: request.index }, files }
}

export async function findInPageBuild(page: WebContents): Promise<FindOutputFile> {
  const buildId = pageBuildId(page)
  const build = buildId ? await installations.get(buildId).catch(() => null) : null
  if (!build) return async () => null
  return (file, bytes) => comfyOutputPath(build, file, bytes)
}
