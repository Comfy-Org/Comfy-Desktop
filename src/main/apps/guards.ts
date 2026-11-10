export const DEFAULT_APPS_URL = 'https://apps.comfy.org/'

export function appsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env['COMFY_APPS_URL'] || DEFAULT_APPS_URL
}

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

export function isAppsFrameUrl(frameUrl: string, origin: string | null): boolean {
  if (!origin) return false
  try {
    return new URL(frameUrl).origin === origin
  } catch {
    return false
  }
}

export function isAppOpen(pageUrl: string, listUrl: string): boolean {
  let page: URL
  let list: URL
  try {
    page = new URL(pageUrl)
    list = new URL(listUrl)
  } catch {
    return false
  }
  if (page.origin !== list.origin) return false
  if (page.pathname !== list.pathname) return true
  return page.hash.startsWith('#/') && page.hash.length > 2
}

const MAX_WORKFLOW_BYTES = 1_000_000
export const MAX_UPLOAD_BYTES = 50_000_000

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

const MAX_OPEN_NODES = 500
const CREDENTIAL_INPUTS = /^(api_key_comfy_org|auth_token_comfy_org)$/i

export interface OpenRequest {
  prompt: Record<string, unknown>
  where: 'local' | 'cloud'
  name: string
  build?: string
}

export function isBuildId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

export function workflowName(value: unknown): string {
  const v = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  return /^[A-Za-z0-9 .,()-]{1,80}$/.test(v) ? v : 'Comfy app'
}

function carriesCredentials(prompt: Record<string, unknown>): boolean {
  return Object.values(prompt).some((node) =>
    Object.keys((node as { inputs: object | null }).inputs ?? {}).some((k) =>
      CREDENTIAL_INPUTS.test(k)
    )
  )
}

export function openRequest(input: unknown): OpenRequest | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'That is not a workflow.' }
  }
  const { prompt, where, name, build } = input as Record<string, unknown>
  if (where !== 'local' && where !== 'cloud') {
    return { error: 'Open it on Comfy Cloud or this computer.' }
  }
  if (build !== undefined && (where !== 'local' || !isBuildId(build))) {
    return { error: 'Pick one of your builds on this computer.' }
  }
  if (!isWorkflow(prompt)) return { error: 'That is not a workflow.' }
  const count = Object.keys(prompt).length
  if (count < 1 || count > MAX_OPEN_NODES) return { error: 'That is not a workflow.' }
  if (carriesCredentials(prompt)) return { error: 'Leave keys out of the workflow.' }
  return { prompt, where, name: workflowName(name), ...(build !== undefined ? { build } : {}) }
}

const FIND_COMFY_APP =
  `var app=window.app||(window.comfyAPI&&window.comfyAPI.app&&window.comfyAPI.app.app);` +
  `if(!app||!app.graph||!app.canvas||typeof app.loadApiJson!=='function')return false;` +
  `var busy=document.querySelector('[data-testid="app-loading-overlay"]');` +
  `if(busy&&busy.getAttribute('aria-busy')==='true')return false;`

export const COMFY_READY_SCRIPT = `(function(){${FIND_COMFY_APP}return true})()`

export function openWorkflowScript(req: OpenRequest): string {
  const prompt = JSON.stringify(req.prompt)
  const name = JSON.stringify(req.name)
  return (
    `(function(prompt,name){` +
    FIND_COMFY_APP +
    `return Promise.resolve(app.loadApiJson(prompt,name)).then(function(r){return r!==false},function(){return false});` +
    `})(${prompt},${name})`
  )
}

export function isComfyPage(pageUrl: string, comfyUrl: string): boolean {
  try {
    const page = new URL(pageUrl)
    const comfy = new URL(comfyUrl)
    return /^https?:$/.test(page.protocol) && page.origin === comfy.origin
  } catch {
    return false
  }
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

export function safeUploadName(name: unknown): string {
  const base = typeof name === 'string' ? (name.split(/[\\/]/).pop() ?? '') : ''
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)
  return /\.(png|jpe?g|webp|mp4|webm|mov)$/i.test(cleaned) ? cleaned : 'upload.png'
}

export type OutputKind = 'image' | 'video' | 'audio' | '3d' | 'text' | 'file'

export function outputKind(filename: string): OutputKind {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus'].includes(ext)) return 'audio'
  if (['glb', 'gltf', 'obj', 'fbx', 'ply'].includes(ext)) return '3d'
  if (['txt', 'json', 'md', 'csv'].includes(ext)) return 'text'
  return 'file'
}

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
  'avif',
  'exr',
  'mp4',
  'webm',
  'mov',
  'mp3',
  'wav',
  'glb',
  'txt',
  'json'
]

export function saveExt(value: unknown): string | null {
  const ext = typeof value === 'string' ? value.toLowerCase().replace(/^\./, '') : ''
  return SAVE_EXTS.includes(ext) ? ext : null
}

export function savedFileName(label: string, ext: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}`
  return `${stamp} ${label}.${ext}`
}

export function isInside(file: string, root: string, sep = '/'): boolean {
  return file.startsWith(root.endsWith(sep) ? root : root + sep)
}

export function readable(text: string | undefined): string | undefined {
  if (!text) return undefined
  const said = text.match(/"message":\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  return (said ?? text).trim()
}

export const VERSIONS_FILE = 'versions.json'

export function isVersionsIndex(bytes: unknown): bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2_000_000) return false
  try {
    const v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    return !!v && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}

export function uploadForm(bytes: Uint8Array, name: unknown): FormData {
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(bytes)]), safeUploadName(name))
  form.append('overwrite', 'true')
  return form
}

export interface LocalAnswer {
  status: number
  contentType: string
  body: Uint8Array
}

export function textAnswer(status: number, text: string): LocalAnswer {
  return { status, contentType: 'text/plain; charset=utf-8', body: new TextEncoder().encode(text) }
}

export type LocalRequest =
  | { kind: 'get'; path: string }
  | { kind: 'prompt'; path: '/prompt'; json: string }
  | { kind: 'json'; path: '/interrupt' | '/queue'; json: string }
  | { kind: 'upload'; path: '/upload/image'; bytes: Uint8Array; fileName: string }

export interface LocalRefusal {
  status: number
  error: string
}

const MAX_PROMPT_BODY_BYTES = 2_000_000
const VIEW_TYPES = ['output', 'input', 'temp']
const LOCAL_BASE = 'http://127.0.0.1'

export function viewQuery(params: URLSearchParams): string | null {
  const keys = [...params.keys()]
  if (new Set(keys).size !== keys.length) return null
  if (keys.some((k) => !['filename', 'subfolder', 'type'].includes(k))) return null
  const filename = params.get('filename') ?? ''
  const subfolder = params.get('subfolder') ?? ''
  const type = params.get('type') ?? ''
  if (!filename || filename.length > 255 || /[\\/\0]/.test(filename)) return null
  if (filename === '.' || filename === '..') return null
  if (subfolder.length > 255 || subfolder.includes('..') || subfolder.includes('\0')) return null
  if (/^[\\/]/.test(subfolder) || /^[A-Za-z]:/.test(subfolder)) return null
  if (!VIEW_TYPES.includes(type)) return null
  return new URLSearchParams({ filename, subfolder, type }).toString()
}

function smallObject(body: unknown): Record<string, unknown> | null {
  let value = body
  if (typeof body === 'string') {
    if (body.length > 10_000) return null
    try {
      value = JSON.parse(body)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return JSON.stringify(value).length > 10_000 ? null : (value as Record<string, unknown>)
}

export function interruptJson(body: unknown): string | null {
  const v = smallObject(body)
  if (!v || Object.keys(v).join() !== 'prompt_id' || !isRunId(v['prompt_id'])) return null
  return JSON.stringify({ prompt_id: v['prompt_id'] })
}

export function queueJson(body: unknown): string | null {
  const v = smallObject(body)
  if (!v || Object.keys(v).join() !== 'delete') return null
  const ids = v['delete']
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || !ids.every(isRunId)) return null
  return JSON.stringify({ delete: ids })
}

function promptJson(body: unknown): string | null {
  let value = body
  if (typeof body === 'string') {
    if (body.length > MAX_PROMPT_BODY_BYTES) return null
    try {
      value = JSON.parse(body)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!isWorkflow((value as { prompt?: unknown }).prompt)) return null
  const json = JSON.stringify(value)
  return json.length > MAX_PROMPT_BODY_BYTES ? null : json
}

export function localRequest(input: unknown): LocalRequest | LocalRefusal {
  if (!input || typeof input !== 'object') return { status: 400, error: 'Not a request.' }
  const { method, path, body, fileName } = input as Record<string, unknown>
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048) {
    return { status: 400, error: 'Not a path.' }
  }
  let url: URL
  try {
    url = new URL(path, LOCAL_BASE)
  } catch {
    return { status: 400, error: 'Not a path.' }
  }
  if (url.origin !== LOCAL_BASE) return { status: 400, error: 'Not a path.' }
  const p = url.pathname
  const query = url.search !== ''
  if (method === 'GET') {
    if (p === '/system_stats' && !query) return { kind: 'get', path: p }
    if (/^\/object_info\/[A-Za-z0-9_]{1,200}$/.test(p) && !query) return { kind: 'get', path: p }
    if (/^\/history\/[A-Za-z0-9-]{1,64}$/.test(p) && !query) return { kind: 'get', path: p }
    if (p === '/view') {
      const q = viewQuery(url.searchParams)
      return q ? { kind: 'get', path: `/view?${q}` } : { status: 400, error: 'Not a file.' }
    }
    return { status: 404, error: 'Apps cannot ask ComfyUI for that.' }
  }
  if (method === 'POST') {
    if (p === '/prompt' && !query) {
      const json = promptJson(body)
      return json
        ? { kind: 'prompt', path: p, json }
        : { status: 400, error: 'That is not a workflow.' }
    }
    if (p === '/interrupt' && !query) {
      const json = interruptJson(body)
      return json
        ? { kind: 'json', path: p, json }
        : { status: 400, error: 'Name the run to stop.' }
    }
    if (p === '/queue' && !query) {
      const json = queueJson(body)
      return json
        ? { kind: 'json', path: p, json }
        : { status: 400, error: 'Name the runs to remove.' }
    }
    if (p === '/upload/image' && !query) {
      if (!(body instanceof Uint8Array)) return { status: 400, error: 'Not a file.' }
      if (body.byteLength > MAX_UPLOAD_BYTES)
        return { status: 413, error: 'Pick a file under 50 MB.' }
      return { kind: 'upload', path: p, bytes: body, fileName: safeUploadName(fileName) }
    }
    return { status: 404, error: 'Apps cannot send ComfyUI that.' }
  }
  return { status: 405, error: 'Apps can only GET and POST.' }
}

export async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get('content-length')) > max) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

export const LOCAL_EVENT_TYPES = [
  'execution_start',
  'execution_cached',
  'executing',
  'progress',
  'progress_state',
  'executed',
  'execution_success',
  'execution_error',
  'execution_interrupted',
  'status'
]

export function localEvent(frame: unknown): { type: string; data: unknown } | null {
  if (typeof frame !== 'string') return null
  let msg: unknown
  try {
    msg = JSON.parse(frame)
  } catch {
    return null
  }
  if (!msg || typeof msg !== 'object') return null
  const { type, data } = msg as { type?: unknown; data?: unknown }
  return typeof type === 'string' && LOCAL_EVENT_TYPES.includes(type) ? { type, data } : null
}

export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt))
}

export interface LocalInstall {
  id: string
  name: string
  sourceId: string
  status?: string
  lastLaunchedAt?: number
  lastLaunchedAtByCategory?: Record<string, number>
  appsBuild?: unknown
}

export function localInstalls<T extends LocalInstall>(
  list: readonly T[],
  categoryOf: (inst: T) => string | undefined
): T[] {
  const usable = list.filter(
    (inst) =>
      categoryOf(inst) === 'local' &&
      inst.sourceId !== 'desktop' &&
      inst.appsBuild !== true &&
      (inst.status === undefined || inst.status === 'installed')
  )
  const at = (inst: T) => inst.lastLaunchedAtByCategory?.['local'] ?? inst.lastLaunchedAt ?? -1
  return usable
    .map((inst, i) => ({ inst, i }))
    .sort((a, b) => at(b.inst) - at(a.inst) || a.i - b.i)
    .map(({ inst }) => inst)
}

export const DOWNLOAD_FOLDERS = [
  'checkpoints',
  'controlnet',
  'loras',
  'vae',
  'upscale_models',
  'clip_vision',
  'text_encoders',
  'diffusion_models',
  'model_patches',
  'background_removal'
]

export interface DownloadRequest {
  url: string
  folder: string
  name: string
}

export function downloadRequest(input: unknown): DownloadRequest | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Name a model to download.' }
  const { url, folder, name } = input as Record<string, unknown>
  let parsed: URL
  try {
    parsed = new URL(typeof url === 'string' ? url : '')
  } catch {
    return { error: 'Models download only from huggingface.co.' }
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'huggingface.co' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname.length < 2
  ) {
    return { error: 'Models download only from huggingface.co.' }
  }
  if (typeof folder !== 'string' || !DOWNLOAD_FOLDERS.includes(folder)) {
    return { error: 'Apps cannot put a model in that folder.' }
  }
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,128}\.(safetensors|pth)$/.test(name)) {
    return { error: 'A model name ends in .safetensors or .pth.' }
  }
  if (name.startsWith('.')) return { error: 'A model name ends in .safetensors or .pth.' }
  return { url: parsed.href, folder, name }
}

const ERR_ABORTED = -3

export function isPageLoadFailure(errorCode: number): boolean {
  return errorCode !== 0 && errorCode !== ERR_ABORTED
}

export function isDocumentFailure(httpResponseCode: number): boolean {
  return httpResponseCode > 0 && (httpResponseCode < 200 || httpResponseCode >= 300)
}
