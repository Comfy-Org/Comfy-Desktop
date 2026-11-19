import { computed, reactive } from 'vue'
import {
  CLOUD_ASSETS,
  CLOUD_WORKFLOWS,
  LOCAL_ASSET_FOLDERS,
  LOCAL_WORKFLOW_FOLDERS,
  PROJECTS,
  type LocalFolder,
  type Modality
} from './mock'
import { instances, proto } from './useProto'
import { realDataOn, realWorkflows, relativeTime } from './realData'

/**
 * One asset model for the Assets gallery, whether the file lives in a local
 * input/output folder or on Comfy Cloud, so every filter and tile treats
 * them the same.
 */
export type AssetSource = 'local' | 'cloud'

export interface GalleryAsset {
  id: string
  name: string
  type: Modality
  source: AssetSource
  thumbId?: string
  project?: string
  size: string
  sizeMb: number
  /** 0 = newest. */
  age: number
  when: string
  bucket: 'today' | 'week' | 'month'
  /** Local only: folder it lives in. */
  folderId?: string
  /** Environment that produced it (instance id). */
  envId?: string
}

const typeOf = (kind: string): Modality | null =>
  kind === 'image' || kind === 'video' || kind === 'audio' || kind === '3d' ? kind : null

const bucketOf = (when: string): GalleryAsset['bucket'] =>
  /min|hour|today/i.test(when) ? 'today' : /day|yesterday|week/i.test(when) ? 'week' : 'month'

const ageOf = (when: string): number => {
  const n = parseInt(when) || 1
  if (/min/.test(when)) return n
  if (/hour/.test(when)) return n * 60
  if (/yesterday/i.test(when)) return 1440
  if (/day/.test(when)) return n * 1440
  if (/week/i.test(when)) return (n || 1) * 10080
  return 50000
}

const mbOf = (size: string): number =>
  size.includes('KB') ? parseFloat(size) / 1000 : parseFloat(size) || 0

function fromFolder(f: LocalFolder): GalleryAsset[] {
  return f.files.flatMap((file, i) => {
    const type = typeOf(file.kind)
    if (!type) return []
    return [
      {
        id: `${f.id}-${i}`,
        name: file.name,
        type,
        source: 'local' as const,
        thumbId: file.thumbId,
        size: file.size,
        sizeMb: mbOf(file.size),
        age: ageOf(file.modified),
        when: file.modified,
        bucket: bucketOf(file.modified),
        folderId: f.id,
        envId: f.instanceId
      }
    ]
  })
}

/** Local folders the gallery reads: instance input/output + user-added. */
export const localFolders = computed<LocalFolder[]>(() => [
  ...LOCAL_ASSET_FOLDERS.filter(
    (f) => !f.instanceId || instances.value.some((i) => i.id === f.instanceId)
  ),
  ...proto.extraAssetFolders
])

// A new user (Mar's proposal: UI Playground › User) has made nothing yet:
// no outputs, no saved workflows, local or in the cloud.
export const allAssets = computed<GalleryAsset[]>(() => (proto.newUser ? [] : mockAssets.value))

const mockAssets = computed<GalleryAsset[]>(() => [
  ...localFolders.value.flatMap(fromFolder),
  ...(proto.signedIn
    ? CLOUD_ASSETS.map((a) => ({
        ...a,
        source: 'cloud' as const,
        thumbId: a.type === 'audio' ? undefined : a.thumbId,
        envId: cloudEnvFor(a.project)
      }))
    : [])
])

/** With projects, a workflow lives in a project and the project runs on one
 *  environment - so (in this mock) the environment decides the project. */
function projectFor(envId?: string): string | undefined {
  return PROJECTS.find((p) => p.envId === envId)?.name
}

/** Mock: work in the "Product campaign" project runs on the Product Shots
 *  dedicated environment; everything else on shared Comfy Cloud. */
function cloudEnvFor(project?: string): string {
  return project === 'Product campaign' ? 'dep-product' : 'cloud'
}

/** Cloud assets the user has pulled down, keyed by asset id → folder id. */
export const downloads = reactive(new Map<string, string>())

// --- Workflows (projects) ----------------------------------------------

export interface ProjectWorkflow {
  id: string
  name: string
  source: AssetSource
  thumbId: string
  category: 'image' | 'video'
  project?: string
  modified: string
  age: number
  /** Local: the instance and folder it lives in. */
  instanceId?: string
  folderId?: string
  /** Cloud: saved version number. */
  version?: number
  /** Environment it opens in (instance id). */
  envId?: string
}

/** Workflow folders the Local view reads: each instance's
 *  user/default/workflows + folders the user added. */
export const workflowFolders = computed<LocalFolder[]>(() => [
  ...LOCAL_WORKFLOW_FOLDERS.filter(
    (f) => !f.instanceId || instances.value.some((i) => i.id === f.instanceId)
  ),
  ...proto.extraWorkflowFolders
])

const categoryOf = (thumbId: string): 'image' | 'video' =>
  /video|i2v|t2v|ltx|wan/.test(thumbId) ? 'video' : 'image'

/** The user's real workflows ("Data: Mine"), in the gallery's shape. They
 *  have no thumbnail: cards show the node graph alone. */
const realProjectWorkflows = computed<ProjectWorkflow[]>(() =>
  realWorkflows.value.map((w) => {
    const env = instances.value.find((i) => i.id === w.envId)
    const name = w.path
      .split('/')
      .pop()!
      .replace(/\.json$/, '')
    return {
      id: `${w.envId}:${w.path}`,
      name,
      source: env?.kind === 'cloud' ? ('cloud' as const) : ('local' as const),
      thumbId: '',
      category: categoryOf(name.toLowerCase()),
      modified: relativeTime(w.modified),
      age: Math.max(1, Math.round((Date.now() - w.modified) / 60000)),
      instanceId: env?.kind === 'local' ? w.envId : undefined,
      envId: w.envId
    }
  })
)

export const allWorkflows = computed<ProjectWorkflow[]>(() =>
  realDataOn.value ? realProjectWorkflows.value : mockWorkflows.value
)

const mockWorkflows = computed<ProjectWorkflow[]>(() => (proto.newUser ? [] : savedWorkflows.value))

const savedWorkflows = computed<ProjectWorkflow[]>(() => [
  ...workflowFolders.value.flatMap((f) =>
    f.files
      .filter((file) => file.kind === 'workflow')
      .map((file, i) => ({
        id: `${f.id}-${i}`,
        name: file.name.replace(/\.json$/, ''),
        source: 'local' as const,
        thumbId: file.thumbId ?? 'image_z_image_turbo',
        category: categoryOf(file.thumbId ?? ''),
        project: projectFor(f.instanceId),
        modified: file.modified,
        age: ageOf(file.modified),
        instanceId: f.instanceId,
        folderId: f.id,
        envId: f.instanceId
      }))
  ),
  ...(proto.signedIn
    ? CLOUD_WORKFLOWS.map((w, i) => ({
        id: `cloud-${i}`,
        name: w.name.replace(/\.json$/, ''),
        source: 'cloud' as const,
        thumbId: w.thumbId,
        category: categoryOf(w.thumbId),
        project: projectFor(cloudEnvFor(w.project)),
        modified: w.modified,
        age: ageOf(w.modified),
        version: ((w.name.length * 7) % 6) + 1,
        envId: cloudEnvFor(w.project)
      }))
    : [])
])
