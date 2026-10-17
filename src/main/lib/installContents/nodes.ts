import path from 'path'
import type {
  InstallContentsPage,
  InstallContentsRequest,
  InstallNodePack
} from '../../../types/ipc'
import { scanCustomNodes } from '../nodes'
import { cloudGet, cloudSignedOut } from './cloudApi'
import { getCloudSession } from '../../devplatform/session'
import { byName, pageOf } from './listing'

/** The custom node packs in a build's `custom_nodes` folder, enabled and
 *  disabled, read the way ComfyUI-Manager v4 does. */
export async function listLocalNodes(
  customNodesDir: string,
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallNodePack>> {
  const scanned = await scanCustomNodes(path.dirname(customNodesDir))
  const packs = scanned.map((node) => ({
    id: node.id,
    name: node.dirName.replace(/\.py$/, ''),
    version: node.version,
    enabled: node.enabled
  }))
  return pageOf(packs, request, { text: (p) => p.name, compare: byName, truncated: false })
}

/** Cloud's node catalog changes with a Cloud release, not per request. */
const CLOUD_PACKS_TTL_MS = 10 * 60_000
let cloudPacks: { at: number; packs: InstallNodePack[] } | null = null

type NodeCatalog = Record<string, { python_module?: string }>

function isNodeCatalog(data: unknown): data is NodeCatalog {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

/** The packs behind a node catalog: each node's `python_module` is
 *  `custom_nodes.<pack>[.…]` for a custom node; core and partner nodes are
 *  not packs. */
export function packsOf(objectInfo: NodeCatalog): InstallNodePack[] {
  const counts = new Map<string, number>()
  for (const node of Object.values(objectInfo)) {
    const [root, pack] = (node.python_module ?? '').split('.')
    if (root !== 'custom_nodes' || !pack) continue
    counts.set(pack, (counts.get(pack) ?? 0) + 1)
  }
  return [...counts].map(([name, nodeCount]) => ({ id: name, name, enabled: true, nodeCount }))
}

/** The node packs Comfy Cloud runs. Cloud has no pack list: they are read
 *  from its node catalog (`/api/object_info`), with how many nodes each adds
 *  but no version. Cloud installs and updates them (`managed`). */
export async function listCloudNodes(
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallNodePack>> {
  if (!getCloudSession().isSignedIn()) return cloudSignedOut()
  if (!cloudPacks || Date.now() - cloudPacks.at > CLOUD_PACKS_TTL_MS) {
    const res = await cloudGet('/api/object_info', {}, isNodeCatalog)
    if (!res.ok) return res
    cloudPacks = { at: Date.now(), packs: packsOf(res.data) }
  }
  const page = pageOf(cloudPacks.packs, request, {
    text: (p) => p.name,
    compare: byName,
    truncated: false
  })
  return page.ok ? { ...page, managed: true } : page
}
