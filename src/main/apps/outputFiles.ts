import path from 'path'
import type { WebContents } from 'electron'

import type { AppOutput, AppOutputs } from '../../types/ipc'
import * as installations from '../installations'
import { comfyOutputPath } from '../lib/outputFolders'
import { pageBuildId } from './localComfy'
import type { ComfyOutputFile, OutputRequest } from './outputRequest'

export type FindOutputFile = (file: ComfyOutputFile, bytes: Uint8Array) => Promise<string | null>

export interface LocatedOutputs {
  outputs: AppOutputs
  files: (string | null)[]
}

export async function locateOutputFiles(
  request: OutputRequest,
  find: FindOutputFile
): Promise<LocatedOutputs> {
  const files = await Promise.all(
    request.items.map((item) =>
      item.comfyFile ? find(item.comfyFile, item.bytes).catch(() => null) : null
    )
  )
  const items = request.items.map(({ comfyFile, folder, ...output }, i): AppOutput => {
    const file = files[i]
    if (file) return { ...output, folder: path.dirname(file) }
    return folder && !comfyFile ? { ...output, folder } : output
  })
  return { outputs: { items, index: request.index }, files }
}

export async function findInPageBuild(page: WebContents): Promise<FindOutputFile> {
  const buildId = pageBuildId(page)
  const build = buildId ? await installations.get(buildId) : null
  if (!build) return async () => null
  return (file, bytes) => comfyOutputPath(build, file, bytes)
}
