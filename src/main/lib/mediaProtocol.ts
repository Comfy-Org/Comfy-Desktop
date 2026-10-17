import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { net, protocol, session } from 'electron'
import { CLOUD_ISSUER } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import * as installations from '../installations'
import { isRolloutEnabled } from '../settings'
import type { InstallFolders } from './installFolders'

/**
 * `comfy-media://` serves a build's images, video and audio to the Builds
 * dashboard, whose CSP allows neither `file://` nor authenticated Cloud URLs.
 *
 *   comfy-media://local/<installationId>/<output|input>/<path>
 *       An image, video or audio file inside the build's output or input
 *       folder, as launch resolves them. Paths that escape the folder (`..`,
 *       absolute paths, symlinks pointing out) are refused.
 *   comfy-media://cloud/<assetId>
 *       A Comfy Cloud asset, fetched with the session token from the Cloud
 *       origin only. Redirects to signed storage are followed without it.
 *
 * Byte ranges are passed on, for video. Responses are never content-sniffed.
 *
 * Registered on the default session only (the dashboard's); ComfyUI views use
 * their own partitions. Every request is refused while the dashboard is off.
 */
const MEDIA_SCHEME = 'comfy-media'

export type MediaArea = 'output' | 'input'

type MediaTarget =
  | { kind: 'local'; installationId: string; area: MediaArea; relativePath: string }
  | { kind: 'cloud'; assetId: string }

const MEDIA_TYPES: Record<string, 'image' | 'video' | 'audio'> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.avif': 'image',
  '.bmp': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.opus': 'audio'
}

/** The kind of media a file is, by extension; undefined for anything else. */
export function mediaTypeOf(fileName: string): 'image' | 'video' | 'audio' | undefined {
  return MEDIA_TYPES[path.extname(fileName).toLowerCase()]
}

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A local file's dashboard URL. */
export function localMediaUrl(
  installationId: string,
  area: MediaArea,
  relativePath: string
): string {
  const segments = relativePath.split('/').map(encodeURIComponent).join('/')
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(installationId)}/${area}/${segments}`
}

export function cloudMediaUrl(assetId: string): string {
  return `${MEDIA_SCHEME}://cloud/${encodeURIComponent(assetId)}`
}

/** What a `comfy-media://` URL names, or null when it is malformed. */
export function parseMediaUrl(rawUrl: string): MediaTarget | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${MEDIA_SCHEME}:`) return null
  let segments: string[]
  try {
    segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  if (url.hostname === 'cloud' && segments.length === 1) {
    return ASSET_ID.test(segments[0]!) ? { kind: 'cloud', assetId: segments[0]! } : null
  }
  if (url.hostname !== 'local' || segments.length < 3) return null
  const [installationId, area, ...rest] = segments
  if (area !== 'output' && area !== 'input') return null
  if (rest.some((s) => s === '..' || s === '.' || s.includes('/') || s.includes('\\'))) return null
  return { kind: 'local', installationId: installationId!, area, relativePath: rest.join('/') }
}

/**
 * The absolute file a local target names, only if it lies inside its area's
 * folder once symlinks are resolved. Null for anything else, including a
 * missing file.
 */
export async function resolveAreaFile(
  folders: Pick<InstallFolders, MediaArea>,
  area: MediaArea,
  relativePath: string
): Promise<string | null> {
  if (path.isAbsolute(relativePath)) return null
  try {
    const root = await fs.promises.realpath(folders[area])
    const file = await fs.promises.realpath(path.resolve(root, relativePath))
    const inside = path.relative(root, file)
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null
    return (await fs.promises.stat(file)).isFile() ? file : null
  } catch {
    return null
  }
}

/** Call before the app is ready: media needs a standard, streamable scheme. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

const notFound = (): Response => new Response(null, { status: 404 })

function rangeOf(request: Request): Record<string, string> {
  const range = request.headers.get('range')
  return range ? { range } : {}
}

async function serveLocal(
  target: Extract<MediaTarget, { kind: 'local' }>,
  request: Request,
  foldersOf: (inst: installations.InstallationRecord) => InstallFolders
): Promise<Response> {
  if (!mediaTypeOf(target.relativePath)) return notFound()
  const inst = await installations.get(target.installationId)
  if (!inst) return notFound()
  const file = await resolveAreaFile(foldersOf(inst), target.area, target.relativePath)
  if (!file) return notFound()
  return net.fetch(pathToFileURL(file).toString(), { headers: rangeOf(request) })
}

async function serveCloud(assetId: string, request: Request): Promise<Response> {
  const token = await getCloudSession().getAccessToken()
  if (!token) return new Response(null, { status: 401 })
  const url = new URL(`/api/assets/${encodeURIComponent(assetId)}/content`, CLOUD_ISSUER)
  url.searchParams.set('disposition', 'inline')
  // Node's fetch, not net.fetch: Electron's rejects manual redirects, and the
  // redirect must be followed by hand to drop the token.
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...rangeOf(request) },
    redirect: 'manual'
  })
  const location = res.headers.get('location')
  if (res.status >= 300 && res.status < 400 && location) {
    const signed = new URL(location, url)
    if (signed.protocol !== 'https:') return notFound()
    // Signed storage URLs carry their own authorisation; never forward ours.
    return fetch(signed, { headers: rangeOf(request) })
  }
  return res
}

function withoutSniffing(res: Response): Response {
  const headers = new Headers(res.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/** Serve `comfy-media://` on the default session. Call once the app is ready. */
export function handleMediaRequests(
  foldersOf: (inst: installations.InstallationRecord) => InstallFolders
): void {
  session.defaultSession.protocol.handle(MEDIA_SCHEME, async (request) => {
    if (!isRolloutEnabled('newDashboardEnabled')) return notFound()
    const target = parseMediaUrl(request.url)
    if (!target) return notFound()
    try {
      return withoutSniffing(
        target.kind === 'cloud'
          ? await serveCloud(target.assetId, request)
          : await serveLocal(target, request, foldersOf)
      )
    } catch (err) {
      console.warn('[comfy-media] Request failed:', (err as Error).message)
      return notFound()
    }
  })
}
