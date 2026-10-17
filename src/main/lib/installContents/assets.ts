import path from 'path'
import type { InstallAsset, InstallContentsPage, InstallContentsRequest } from '../../../types/ipc'
import type { InstallFolders } from '../installFolders'
import { cloudMediaUrl, localMediaUrl, mediaTypeOf, resolveAreaFile } from '../mediaProtocol'
import type { MediaArea } from '../mediaProtocol'
import { cloudGet, isAssetPage } from './cloudApi'
import { MAX_LISTED_ENTRIES, byName, pageOf, pageSize, walkFiles } from './listing'

const AREAS: MediaArea[] = ['output', 'input']

/** Media files read per listing: enough to find the newest in a busy output
 *  folder, short of stalling on a huge one. */
const MAX_WALKED_ASSETS = 50_000

/** Media, of the kind the request's `filter` keeps (any when unset). */
function isWanted(
  mediaType: InstallAsset['mediaType'] | undefined,
  request: InstallContentsRequest
): mediaType is InstallAsset['mediaType'] {
  return mediaType !== undefined && (!request.filter || mediaType === request.filter)
}

/** A local asset's id: its area and path, e.g. `output/ComfyUI_00001_.png`. */
function assetId(area: MediaArea, relativePath: string): string {
  return `${area}/${relativePath}`
}

/** The images, video and audio in a build's output and input folders, newest
 *  first. A folder shared by both areas is listed once. Past the listing cap,
 *  the newest of the files read are kept. */
export async function listLocalAssets(
  installationId: string,
  folders: Pick<InstallFolders, MediaArea>,
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallAsset>> {
  const assets: InstallAsset[] = []
  const seen = new Set<string>()
  let truncated = false
  for (const area of AREAS) {
    if (seen.has(path.resolve(folders[area]))) continue
    seen.add(path.resolve(folders[area]))
    const walked = await walkFiles(
      folders[area],
      (name) => isWanted(mediaTypeOf(name), request),
      MAX_WALKED_ASSETS - assets.length,
      // comfy-media serves nothing outside the folder, so list nothing there.
      true
    )
    truncated ||= walked.truncated
    for (const file of walked.files) {
      assets.push({
        id: assetId(area, file.relativePath),
        name: path.posix.basename(file.relativePath),
        mediaType: mediaTypeOf(file.relativePath)!,
        url: localMediaUrl(installationId, area, file.relativePath),
        category: area,
        size: file.size,
        createdAt: file.createdAt,
        modifiedAt: file.modifiedAt,
        revealable: true
      })
    }
  }
  const newest = assets.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, MAX_LISTED_ENTRIES)
  return pageOf(newest, request, {
    text: (a) => a.name,
    compare: request.sort === 'name' ? byName : (a, b) => b.modifiedAt - a.modifiedAt,
    truncated: truncated || assets.length > MAX_LISTED_ENTRIES
  })
}

/** The file a local asset id names, inside its area's folder, or null. */
export async function localAssetFile(
  folders: Pick<InstallFolders, MediaArea>,
  id: string
): Promise<string | null> {
  const slash = id.indexOf('/')
  const area = id.slice(0, slash)
  if (slash < 0 || (area !== 'output' && area !== 'input')) return null
  return resolveAreaFile(folders, area, id.slice(slash + 1))
}

interface CloudAsset {
  id: string
  name: string
  size?: number | string
  hash?: string
  tags?: string[]
  mime_type?: string | null
  created_at?: string
  updated_at?: string
  user_metadata?: { filename?: string } | null
}

function cloudMediaType(asset: CloudAsset, name: string): InstallAsset['mediaType'] | undefined {
  const major = typeof asset.mime_type === 'string' ? asset.mime_type.split('/')[0] : undefined
  if (major === 'image' || major === 'video' || major === 'audio') return major
  return mediaTypeOf(name)
}

/** The workspace's generated outputs on Comfy Cloud, newest first, paged by
 *  the API. They are view-only: there is no local file to reveal. */
export async function listCloudAssets(
  request: InstallContentsRequest
): Promise<InstallContentsPage<InstallAsset>> {
  const params: Record<string, string> = {
    include_tags: 'output',
    exclude_tags: 'missing',
    include_public: 'false',
    sort: request.sort === 'name' ? 'name' : 'created_at',
    order: request.sort === 'name' ? 'asc' : 'desc',
    limit: String(pageSize(request))
  }
  if (request.query?.trim()) params.name_contains = request.query.trim()
  if (request.cursor) params.after = request.cursor
  const res = await cloudGet('/api/assets', params, isAssetPage<CloudAsset>)
  if (!res.ok) return res
  const { assets, total, has_more, next_cursor } = res.data
  const items = assets.flatMap((asset): InstallAsset[] => {
    // The rows are not validated one by one: skip one without a usable name.
    const fileName = asset.user_metadata?.filename || asset.name
    if (typeof fileName !== 'string' || typeof asset.id !== 'string') return []
    // Cloud names outputs by their sub-folder path (`video/clip_00001_.mp4`).
    const name = path.posix.basename(fileName)
    const mediaType = cloudMediaType(asset, name)
    // Cloud cannot filter by media kind: a filtered page may come back short.
    if (!isWanted(mediaType, request)) return []
    const createdAt = Date.parse(asset.created_at ?? '') || 0
    return [
      {
        id: asset.id,
        name,
        mediaType,
        url: cloudMediaUrl(asset.id),
        category: 'output',
        size: Number.isFinite(Number(asset.size)) ? Number(asset.size) : 0,
        createdAt,
        modifiedAt: Date.parse(asset.updated_at ?? '') || createdAt,
        revealable: false,
        mimeType: typeof asset.mime_type === 'string' ? asset.mime_type : undefined,
        hash: asset.hash
      }
    ]
  })
  return {
    ok: true,
    items,
    nextCursor: has_more && next_cursor ? next_cursor : null,
    total: total ?? items.length,
    truncated: false
  }
}
