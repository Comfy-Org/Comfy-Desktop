/**
 * Input checks for the Apps bridge. The apps page is a remote site, so every
 * value it sends is checked here before main spends the user's Cloud token on it.
 */

/** Where the Apps section loads from. Swapping the site needs no Desktop release. */
export const DEFAULT_APPS_URL = 'https://apps.comfy.org/'

export function appsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env['COMFY_APPS_URL'] || DEFAULT_APPS_URL
}

/** The one origin the bridge answers. Loopback http is allowed only for local development. */
export function appsOrigin(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol === 'https:') return parsed.origin
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  return parsed.protocol === 'http:' && loopback ? parsed.origin : null
}

/** True when `frameUrl` is a page on the apps origin. */
export function isAppsFrameUrl(frameUrl: string, origin: string | null): boolean {
  if (!origin) return false
  try {
    return new URL(frameUrl).origin === origin
  } catch {
    return false
  }
}

const MAX_WORKFLOW_BYTES = 1_000_000
export const MAX_UPLOAD_BYTES = 20_000_000

/** A ComfyUI API-format graph: node id -> { class_type, inputs }. */
export function isWorkflow(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (JSON.stringify(value).length > MAX_WORKFLOW_BYTES) return false
  return Object.values(value).every(
    (node) =>
      !!node &&
      typeof node === 'object' &&
      typeof (node as { class_type?: unknown }).class_type === 'string' &&
      typeof (node as { inputs?: unknown }).inputs === 'object'
  )
}

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value)
}

export interface OutputFile {
  filename: string
  subfolder: string
  type: 'output' | 'temp'
}

export function toOutputFile(value: unknown): OutputFile | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v['filename'] !== 'string' || !v['filename'] || v['filename'].length > 255) return null
  const subfolder = typeof v['subfolder'] === 'string' ? v['subfolder'] : ''
  if (subfolder.length > 255 || subfolder.includes('..')) return null
  const type = v['type'] === 'temp' ? 'temp' : v['type'] === 'output' ? 'output' : null
  if (!type) return null
  return { filename: v['filename'], subfolder, type }
}

/** Keep only a plain file name; Cloud stores the upload under it. */
export function safeUploadName(name: unknown): string {
  const base = typeof name === 'string' ? (name.split(/[\\/]/).pop() ?? '') : ''
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)
  return /\.(png|jpe?g|webp)$/i.test(cleaned) ? cleaned : 'upload.png'
}
