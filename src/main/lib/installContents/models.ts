import path from 'path'
import type { InstallContentsPage, InstallContentsRequest, InstallModel } from '../../../types/ipc'
import type { InstallFolders } from '../installFolders'
import { cloudGet, isAssetPage } from './cloudApi'
import { MAX_LISTED_ENTRIES, byName, countBy, pageOf, pageSize, walkFiles } from './listing'

/** The weight formats ComfyUI loads (`supported_pt_extensions`, plus GGUF). */
const MODEL_EXTENSIONS = new Set([
  '.safetensors',
  '.sft',
  '.ckpt',
  '.pt',
  '.pt2',
  '.pth',
  '.bin',
  '.pkl',
  '.gguf'
])

function isModelFile(name: string): boolean {
  return MODEL_EXTENSIONS.has(path.extname(name).toLowerCase())
}

/** Every model file the build's ComfyUI can see: each model root's
 *  `<type>/` folders, then the per-type folders of `extra_model_paths.yaml`.
 *  A file reached through two roots is listed once. The filter row is the
 *  model types; `filter` keeps one. */
export async function listLocalModels(
  folders: Pick<InstallFolders, 'modelRoots' | 'extraModelPaths'>,
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallModel>> {
  const seen = new Set<string>()
  const models: InstallModel[] = []
  let truncated = false
  const add = (absolutePath: string, model: InstallModel): void => {
    if (seen.has(absolutePath)) return
    seen.add(absolutePath)
    models.push(model)
  }
  const remaining = (): number => MAX_LISTED_ENTRIES - models.length

  for (const root of folders.modelRoots) {
    if (remaining() <= 0) break
    const walked = await walkFiles(root, isModelFile, remaining())
    truncated ||= walked.truncated
    for (const file of walked.files) {
      const [folder, ...rest] = file.relativePath.split('/')
      // Loose files at the root have no type ComfyUI would load them as.
      if (!folder || rest.length === 0) continue
      add(file.absolutePath, {
        name: rest.join('/'),
        folder,
        size: file.size,
        modifiedAt: file.modifiedAt
      })
    }
  }
  for (const extra of folders.extraModelPaths) {
    if (remaining() <= 0) break
    const walked = await walkFiles(extra.dir, isModelFile, remaining())
    truncated ||= walked.truncated
    for (const file of walked.files) {
      add(file.absolutePath, {
        name: file.relativePath,
        folder: extra.type,
        size: file.size,
        modifiedAt: file.modifiedAt
      })
    }
  }
  truncated ||= remaining() <= 0

  const kept = request.filter ? models.filter((m) => m.folder === request.filter) : models
  const page = pageOf(kept, request, {
    text: (m) => `${m.folder}/${m.name}`,
    compare: (a, b) => a.folder.localeCompare(b.folder) || byName(a, b),
    truncated
  })
  return page.ok ? { ...page, facets: countBy(models, (m) => m.folder) } : page
}

interface CloudAsset {
  id: string
  name: string
  size?: number
  tags?: string[]
  user_metadata?: { filename?: string } | null
  /** Set only on the public catalog's models. */
  is_immutable?: boolean
  updated_at?: string
  created_at?: string
}

/** The model type from Cloud's tags: `model_type:<folder>`, else the first
 *  tag that isn't `models` itself. */
function cloudModelFolder(tags: readonly string[]): string {
  const typed = tags.find((tag) => tag.startsWith('model_type:'))
  if (typed) return typed.slice('model_type:'.length)
  return tags.find((tag) => tag !== 'models') ?? ''
}

/** Comfy Cloud's model filter row: everything, the user's own uploads, or the
 *  public catalog. */
export type CloudModelFilter = 'all' | 'mine' | 'public'

function cloudModelParams(request: InstallContentsRequest, includePublic: boolean) {
  const params: Record<string, string> = {
    include_tags: 'models',
    exclude_tags: 'missing',
    include_public: String(includePublic),
    sort: 'name',
    order: 'asc',
    limit: String(pageSize(request))
  }
  if (request.query?.trim()) params.name_contains = request.query.trim()
  return params
}

/** How many models match, with or without the public catalog. */
async function cloudModelCount(
  request: InstallContentsRequest,
  includePublic: boolean
): Promise<number | null> {
  const res = await cloudGet(
    '/api/assets',
    { ...cloudModelParams(request, includePublic), limit: '1' },
    isAssetPage<CloudAsset>
  )
  return res.ok ? (res.data.total ?? null) : null
}

/** The models a Comfy Cloud build can load, paged by the API. Cloud stores
 *  files by hash, so the name shown is the uploaded file name. Cloud has no
 *  "public only" query: that filter lists everything and keeps the public
 *  catalog, so its pages can come back short. */
export async function listCloudModels(
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallModel>> {
  const filter: CloudModelFilter =
    request.filter === 'mine' || request.filter === 'public' ? request.filter : 'all'
  const params = cloudModelParams(request, filter !== 'mine')
  if (request.cursor) params.after = request.cursor
  const [res, all, mine] = await Promise.all([
    cloudGet('/api/assets', params, isAssetPage<CloudAsset>),
    // The filter row's counts, once per listing rather than per page.
    request.cursor ? null : cloudModelCount(request, true),
    request.cursor ? null : cloudModelCount(request, false)
  ])
  if (!res.ok) return res
  const { assets, total, has_more, next_cursor } = res.data
  const items = assets
    .filter((asset) => filter !== 'public' || asset.is_immutable === true)
    .map((asset) => ({
      name: asset.user_metadata?.filename || asset.name,
      folder: cloudModelFolder(asset.tags ?? []),
      size: Number(asset.size ?? 0),
      modifiedAt: Date.parse(asset.updated_at ?? asset.created_at ?? '') || undefined,
      public: asset.is_immutable === true
    }))
  const facets =
    all !== null && mine !== null
      ? [
          { value: 'all', count: all },
          { value: 'mine', count: mine },
          { value: 'public', count: Math.max(0, all - mine) }
        ]
      : undefined
  const filteredTotal = facets?.find((f) => f.value === filter)?.count
  return {
    ok: true,
    items,
    nextCursor: has_more && next_cursor ? next_cursor : null,
    total: filteredTotal ?? total ?? items.length,
    truncated: false,
    facets
  }
}
