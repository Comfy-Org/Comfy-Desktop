export const DEFAULT_APPS_URL = 'https://comfy.org/apps/'

const APPS_URL_BY_CLOUD: ReadonlyMap<string, string> = new Map([
  ['https://cloud.comfy.org', DEFAULT_APPS_URL],
  ['https://stagingcloud.comfy.org', 'https://comfy-website-preview-pr-384.vercel.app/apps/']
])

function cloudAppsUrl(issuer: string): string {
  try {
    return APPS_URL_BY_CLOUD.get(new URL(issuer).origin) ?? DEFAULT_APPS_URL
  } catch {
    return DEFAULT_APPS_URL
  }
}

export function appsUrl(env: NodeJS.ProcessEnv, packaged: boolean, issuer: string): string {
  return (!packaged && env['COMFY_APPS_URL']) || cloudAppsUrl(issuer)
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

const ALLOWED_APPS_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen'
])

export function isAllowedAppsPermission(permission: string): boolean {
  return ALLOWED_APPS_PERMISSIONS.has(permission)
}

export function isAppsFrameUrl(frameUrl: string, appsPage: string): boolean {
  const origin = appsOrigin(appsPage)
  if (!origin) return false
  try {
    const frame = new URL(frameUrl)
    const base = new URL(appsPage).pathname.replace(/\/+$/, '')
    if (frame.origin !== origin) return false
    return frame.pathname === base || frame.pathname.startsWith(`${base}/`)
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
export const MAX_RESULT_BYTES = 100_000_000
export const MAX_SAVE_BYTES = 2_000_000_000

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

export const APP_SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isAppSlug(value: unknown): value is string {
  return typeof value === 'string' && APP_SLUG.test(value)
}

export function appOfPage(pageUrl: string, listUrl: string): string | null {
  let page: URL
  let list: URL
  try {
    page = new URL(pageUrl)
    list = new URL(listUrl)
  } catch {
    return null
  }
  if (page.origin !== list.origin) return null
  const base = list.pathname.endsWith('/') ? list.pathname : `${list.pathname}/`
  const rest = page.pathname.startsWith(base) ? page.pathname.slice(base.length) : ''
  const [first = '', ...more] = rest.split('/')
  const folder = more.length > 0 || !first.includes('.') ? first : ''
  const routed = page.hash.startsWith('#/') ? page.hash.slice(2).split(/[/?]/)[0]! : ''
  const app = folder || routed
  return isAppSlug(app) ? app : null
}

export interface CloudAppTag {
  id: string
  model?: string
  where: 'cloud'
}

export function openAppId(pageUrl: string, listUrl: string): string | null {
  let page: URL
  let list: URL
  try {
    page = new URL(pageUrl)
    list = new URL(listUrl)
  } catch {
    return null
  }
  if (page.origin !== list.origin) return null
  const folder = list.pathname.endsWith('/') ? list.pathname : `${list.pathname}/`
  if (!page.pathname.startsWith(folder)) return null
  const [id, ...rest] = page.pathname.slice(folder.length).split('/')
  return rest.length > 0 && isAppSlug(id) ? id : null
}

export function catalogAppIds(body: unknown): Set<string> {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) throw new Error('The catalog answer has no item list.')
  const ids = new Set<string>()
  for (const item of items) {
    const slug = (item as { data?: { slug?: unknown } | null } | null)?.data?.slug
    if (isAppSlug(slug)) ids.add(slug)
  }
  return ids
}

export function cloudAppTag(
  openApp: string | null,
  desktopApps: ReadonlySet<string>,
  options: unknown
): CloudAppTag | null {
  if (!openApp || !desktopApps.has(openApp)) return null
  const model =
    options && typeof options === 'object' && !Array.isArray(options)
      ? (options as { model?: unknown }).model
      : undefined
  return { id: openApp, ...(isAppSlug(model) ? { model } : {}), where: 'cloud' }
}

export function cloudPromptBody(
  workflow: Record<string, unknown>,
  token: string,
  tag: CloudAppTag | null
): string {
  return JSON.stringify({
    prompt: workflow,
    extra_data: { auth_token_comfy_org: token, ...(tag ? { comfy_app: tag } : {}) }
  })
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
  const filename = v['filename']
  if (typeof filename !== 'string' || !filename || filename.length > 255) return null
  if (/[\\/\0]/.test(filename) || filename === '.' || filename === '..') return null
  const subfolder = typeof v['subfolder'] === 'string' ? v['subfolder'] : ''
  if (subfolder.length > 255 || subfolder.includes('..')) return null
  const type = v['type'] === 'temp' ? 'temp' : v['type'] === 'output' ? 'output' : null
  if (!type) return null
  return { filename, subfolder, type }
}

export function safeUploadName(name: unknown): string {
  const base = typeof name === 'string' ? (name.split(/[\\/]/).pop() ?? '') : ''
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_')
  const ext = /\.(png|jpe?g|webp|mp4|webm|mov|mp3|wav|flac|ogg|m4a|opus)$/i.exec(cleaned)?.[0]
  return ext ? cleaned.slice(0, Math.min(cleaned.length, 100) - ext.length) + ext : 'upload.png'
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
  | { kind: 'queue'; path: '/queue' }
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

export interface RunSeen {
  startedAt: number
  done?: number
  of?: number
}

const MAX_RUNS_SEEN = 50
const RUN_END_TYPES = ['execution_success', 'execution_error', 'execution_interrupted']

export function noteRun(
  seen: Map<string, RunSeen>,
  msg: { type: string; data: unknown },
  now: number
): void {
  const data = (msg.data ?? {}) as { prompt_id?: unknown; value?: unknown; max?: unknown }
  const id = data.prompt_id
  if (!isRunId(id)) return
  if (msg.type === 'execution_start') {
    seen.delete(id)
    seen.set(id, { startedAt: now })
    for (const old of seen.keys()) {
      if (seen.size <= MAX_RUNS_SEEN) break
      seen.delete(old)
    }
    return
  }
  if (msg.type === 'progress') {
    const run = seen.get(id)
    const { value, max } = data
    if (!run || typeof value !== 'number' || typeof max !== 'number') return
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return
    run.done = Math.max(0, Math.min(value, max))
    run.of = max
    return
  }
  if (RUN_END_TYPES.includes(msg.type)) seen.delete(id)
}

export function localAppId(promptJson: string): string | null {
  try {
    const body = JSON.parse(promptJson) as { extra_data?: { comfy_app?: { id?: unknown } } }
    const id = body?.extra_data?.comfy_app?.id
    return isAppSlug(id) ? id : null
  } catch {
    return null
  }
}

export function promptIdOf(answer: Uint8Array): string | null {
  try {
    const id = (JSON.parse(new TextDecoder().decode(answer)) as { prompt_id?: unknown })?.prompt_id
    return isRunId(id) ? id : null
  } catch {
    return null
  }
}

export interface RunEnd {
  id: string
  outcome: 'success' | 'failed' | 'cancelled'
  exceptionType?: string
}

const RUN_OUTCOMES: Readonly<Record<string, RunEnd['outcome']>> = {
  execution_success: 'success',
  execution_error: 'failed',
  execution_interrupted: 'cancelled'
}

export function runEnd(msg: { type: string; data: unknown }): RunEnd | null {
  const outcome = Object.hasOwn(RUN_OUTCOMES, msg.type) ? RUN_OUTCOMES[msg.type] : undefined
  const data = (msg.data ?? {}) as { prompt_id?: unknown; exception_type?: unknown }
  if (!outcome || !isRunId(data.prompt_id)) return null
  const exceptionType =
    outcome === 'failed' && typeof data.exception_type === 'string' ? data.exception_type : null
  return { id: data.prompt_id, outcome, ...(exceptionType ? { exceptionType } : {}) }
}

export interface QueueRun {
  id: string
  app: string | null
  seconds: number | null
  startedAt?: number
  done?: number
  of?: number
}

export interface QueueView {
  running: QueueRun[]
  pending: QueueRun[]
}

const MAX_QUEUE_RUNS = 100
const APP_TAG_NAME = /^[A-Za-z0-9 .,()&'-]{1,40}$/

function appTag(extra: unknown): { app: string | null; seconds: number | null } {
  const tag = (extra as { comfy_app?: unknown } | null)?.comfy_app
  if (!tag || typeof tag !== 'object') return { app: null, seconds: null }
  const { name, seconds } = tag as { name?: unknown; seconds?: unknown }
  return {
    app: typeof name === 'string' && APP_TAG_NAME.test(name) ? name : null,
    seconds:
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400
        ? Math.round(seconds)
        : null
  }
}

function queueRuns(list: unknown, seen: ReadonlyMap<string, RunSeen>): QueueRun[] {
  if (!Array.isArray(list)) return []
  const runs: Array<{ n: number; run: QueueRun }> = []
  for (const item of list) {
    if (!Array.isArray(item)) continue
    const n = typeof item[0] === 'number' && Number.isFinite(item[0]) ? item[0] : 0
    const id = isRunId(item[1]) ? item[1] : ''
    const s = id ? seen.get(id) : undefined
    runs.push({
      n,
      run: {
        id,
        ...appTag(item[3]),
        ...(s ? { startedAt: s.startedAt } : {}),
        ...(s?.of ? { done: s.done ?? 0, of: s.of } : {})
      }
    })
  }
  return runs
    .sort((a, b) => a.n - b.n)
    .slice(0, MAX_QUEUE_RUNS)
    .map((r) => r.run)
}

export function queueView(raw: unknown, seen: ReadonlyMap<string, RunSeen> = new Map()): QueueView {
  const q = (raw && typeof raw === 'object' ? raw : {}) as {
    queue_running?: unknown
    queue_pending?: unknown
  }
  return { running: queueRuns(q.queue_running, seen), pending: queueRuns(q.queue_pending, seen) }
}

export function queueAnswer(
  status: number,
  body: Uint8Array,
  seen: ReadonlyMap<string, RunSeen>
): LocalAnswer {
  if (status < 200 || status >= 300) return textAnswer(status, 'ComfyUI did not show its queue.')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return textAnswer(502, 'ComfyUI sent a queue Desktop could not read.')
  }
  return {
    status: 200,
    contentType: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(queueView(raw, seen)))
  }
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
    if (p === '/queue' && !query) return { kind: 'queue', path: p }
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

export async function readCapped(
  res: Response,
  max: number,
  onChunk: () => void = () => {}
): Promise<Uint8Array | null> {
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
    onChunk()
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

export const JOB_GRACE_MS = 30_000

export function noteSubmitted(submitted: Map<string, number>, runId: string, now: number): void {
  for (const [id, at] of submitted) if (now - at >= JOB_GRACE_MS) submitted.delete(id)
  submitted.set(runId, now)
}

export function inJobGrace(submitted: Map<string, number>, runId: string, now: number): boolean {
  const at = submitted.get(runId)
  if (at === undefined) return false
  if (now - at < JOB_GRACE_MS) return true
  submitted.delete(runId)
  return false
}

export type JobsAnswer = 'read' | 'wait' | 'refused' | { error: string }

export function jobsAnswer(status: number, inGrace: boolean): JobsAnswer {
  if (status >= 200 && status < 300) return 'read'
  if (status === 429 || status >= 500) return 'wait'
  if (status === 404) {
    return inGrace ? 'wait' : { error: 'Comfy Cloud cannot find this run. Run the app again.' }
  }
  if (status === 401) return { error: 'Your Comfy sign-in ended. Sign in again, then run the app.' }
  if (status === 403) return { error: 'Your Comfy account does not have access to this run.' }
  return 'refused'
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
  'background_removal',
  'frame_interpolation',
  'geometry_estimation',
  'audio_encoders'
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
