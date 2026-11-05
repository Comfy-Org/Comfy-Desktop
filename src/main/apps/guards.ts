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
export const MAX_UPLOAD_BYTES = 50_000_000

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
  return /\.(png|jpe?g|webp|mp4|webm|mov)$/i.test(cleaned) ? cleaned : 'upload.png'
}

export type OutputKind = 'image' | 'video' | 'audio' | '3d' | 'text' | 'file'

/** What an output file is, from its extension. SaveVideo lists videos under `images` too. */
export function outputKind(filename: string): OutputKind {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus'].includes(ext)) return 'audio'
  if (['glb', 'gltf', 'obj', 'fbx', 'ply'].includes(ext)) return '3d'
  if (['txt', 'json', 'md', 'csv'].includes(ext)) return 'text'
  return 'file'
}

/**
 * Every output file and text of one /history_v2 entry's `outputs`, by node. Measured on
 * Comfy Cloud 2026-11-04: SaveImage and SaveVideo list files under `images`, SaveGLB under
 * `3d`, SaveText under `files` plus its `text`, PreviewAny only `text`. A loader lists its
 * input (type `input`), which is not a result and is left out.
 */
export function collectOutputs(outputs: unknown): {
  files: Array<OutputFile & { node: string; kind: OutputKind }>
  text: Record<string, string[]>
} {
  const files: Array<OutputFile & { node: string; kind: OutputKind }> = []
  const text: Record<string, string[]> = {}
  if (!outputs || typeof outputs !== 'object') return { files, text }
  for (const [node, out] of Object.entries(outputs as Record<string, unknown>)) {
    if (!out || typeof out !== 'object') continue
    for (const [key, list] of Object.entries(out as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      if (key === 'text') {
        const t = list.filter((x): x is string => typeof x === 'string')
        if (t.length) text[node] = t
        continue
      }
      for (const item of list) {
        const f = toOutputFile(item)
        if (f) files.push({ ...f, node, kind: outputKind(f.filename) })
      }
    }
  }
  return { files, text }
}

/** An app slug or a label for a saved file: letters, digits, dash and space only. */
export function cleanSaveName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/\s+/g, ' ')
  return /^[A-Za-z0-9 -]{1,60}$/.test(v) ? v : null
}

const SAVE_EXTS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'mp4',
  'webm',
  'mov',
  'mp3',
  'wav',
  'glb',
  'txt',
  'json'
]

/** The extension a saved file gets, or null when it is not one apps may write. */
export function saveExt(value: unknown): string | null {
  const ext = typeof value === 'string' ? value.toLowerCase().replace(/^\./, '') : ''
  return SAVE_EXTS.includes(ext) ? ext : null
}

/** `2026-11-04 11-41 film.mp4`: sorts by time and reads well in Finder. */
export function savedFileName(label: string, ext: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}`
  return `${stamp} ${label}.${ext}`
}

/** True when `file` sits inside `root` (both absolute, symlinks already resolved). */
export function isInside(file: string, root: string, sep = '/'): boolean {
  return file.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * A partner node's error wraps the provider's answer as JSON ("Task failed: {...}"); its
 * "message" field is the part a person can read.
 */
export function readable(text: string | undefined): string | undefined {
  if (!text) return undefined
  const said = text.match(/"message":\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  return (said ?? text).trim()
}

/** The one file in an app's folder Desktop writes under a fixed name: the page's list of versions. */
export const VERSIONS_FILE = 'versions.json'

/** A versions index the page hands over: JSON text, an object at the top, at most 2 MB. */
export function isVersionsIndex(bytes: unknown): bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2_000_000) return false
  try {
    const v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    return !!v && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}
