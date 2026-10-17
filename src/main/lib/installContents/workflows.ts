import path from 'path'
import type {
  InstallContentsPage,
  InstallContentsRequest,
  InstallWorkflow
} from '../../../types/ipc'
import { cloudGet } from './cloudApi'
import { byName, pageOf, walkFiles } from './listing'

function workflowOf(relativePath: string, size: number, modifiedAt: number): InstallWorkflow {
  const folder = path.posix.dirname(relativePath)
  return {
    path: relativePath,
    name: path.posix.basename(relativePath, '.json'),
    folder: folder === '.' ? '' : folder,
    size,
    modifiedAt
  }
}

function pageWorkflows(
  workflows: InstallWorkflow[],
  request: InstallContentsRequest,
  truncated: boolean
): InstallContentsPage<InstallWorkflow> {
  return pageOf(workflows, request, {
    text: (w) => w.path,
    compare: request.sort === 'name' ? byName : (a, b) => b.modifiedAt - a.modifiedAt,
    truncated
  })
}

/** The saved workflows in a local build's workflows folder. */
export async function listLocalWorkflows(
  workflowsDir: string,
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallWorkflow>> {
  const { files, truncated } = await walkFiles(workflowsDir, (name) => name.endsWith('.json'))
  return pageWorkflows(
    files.map((f) => workflowOf(f.relativePath, f.size, f.modifiedAt)),
    request,
    truncated
  )
}

interface CloudUserdataEntry {
  path: string
  size?: number
  modified?: number
}

/** The active workspace's saved workflows on Comfy Cloud, listed the way the
 *  ComfyUI frontend lists them. */
export async function listCloudWorkflows(
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallWorkflow>> {
  const res = await cloudGet(
    '/api/userdata',
    { dir: 'workflows', recurse: 'true', split: 'false', full_info: 'true' },
    (data): data is CloudUserdataEntry[] => Array.isArray(data)
  )
  // No workflows folder yet.
  if (!res.ok && res.status === 404) return pageWorkflows([], request, false)
  if (!res.ok) return res
  const workflows = res.data
    .filter((entry) => entry.path.endsWith('.json'))
    .map((entry) =>
      // The API reports seconds or milliseconds depending on the backend.
      workflowOf(
        entry.path,
        entry.size ?? 0,
        entry.modified && entry.modified < 1e12 ? entry.modified * 1000 : (entry.modified ?? 0)
      )
    )
  return pageWorkflows(workflows, request, false)
}
