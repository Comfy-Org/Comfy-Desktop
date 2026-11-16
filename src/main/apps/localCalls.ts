export const MAX_UPLOAD_BYTES = 50_000_000
export const MAX_JSON_BODY_CHARS = 4_000_000
export const UPLOAD_SUBFOLDER = 'comfy-apps'

const PATHNAME = /^(\/[A-Za-z0-9_.+-]+){1,2}$/
const PROMPT_ID = /^[A-Za-z0-9-]{1,64}$/
const NODE_CLASS = /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,127}$/
const FILE_NAME = /^[^\\/\0]{1,255}$/
const SUBFOLDER = /^[^\\\0]{0,255}$/
const UPLOAD_NAME =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm|mp3|wav|flac|ogg|m4a)$/i
const FILE_TYPES: ReadonlySet<string> = new Set(['output', 'temp'])
const APP_NAME_MAX_CHARS = 40

export interface OutputFile {
  filename: string
  subfolder: string
  type: string
}

export type LocalCall =
  | { kind: 'queue' }
  | { kind: 'history'; promptId: string }
  | { kind: 'view'; file: OutputFile }
  | { kind: 'object-info'; node: string }
  | { kind: 'prompt'; prompt: Record<string, unknown>; extraData: Record<string, unknown> }
  | { kind: 'upload'; bytes: Uint8Array; fileName: string }
  | { kind: 'leave-queue'; promptIds: string[] }
  | { kind: 'interrupt'; promptId: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'string' || body.length > MAX_JSON_BODY_CHARS) return null
  try {
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function bytesOf(body: unknown): Uint8Array | null {
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return null
}

function hasParentStep(subfolder: string): boolean {
  return subfolder.split('/').includes('..')
}

function viewCall(query: URLSearchParams): LocalCall | null {
  const filename = query.get('filename') ?? ''
  const subfolder = query.get('subfolder') ?? ''
  const type = query.get('type') ?? 'output'
  if (!FILE_NAME.test(filename) || !SUBFOLDER.test(subfolder) || hasParentStep(subfolder)) {
    return null
  }
  return FILE_TYPES.has(type) ? { kind: 'view', file: { filename, subfolder, type } } : null
}

function readGet(pathname: string, query: URLSearchParams): LocalCall | null {
  if (pathname === '/queue') return { kind: 'queue' }
  if (pathname === '/view') return viewCall(query)
  const [, area, name = ''] = pathname.split('/')
  if (area === 'history' && PROMPT_ID.test(name)) return { kind: 'history', promptId: name }
  if (area === 'object_info' && NODE_CLASS.test(name)) return { kind: 'object-info', node: name }
  return null
}

function promptCall(body: unknown): LocalCall | null {
  const sent = jsonBody(body)
  if (!sent || !isRecord(sent['prompt'])) return null
  const extraData = isRecord(sent['extra_data']) ? sent['extra_data'] : {}
  return { kind: 'prompt', prompt: sent['prompt'], extraData }
}

function uploadCall(body: unknown, fileName: unknown): LocalCall | null {
  const bytes = bytesOf(body)
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null
  if (typeof fileName !== 'string' || !UPLOAD_NAME.test(fileName)) return null
  return { kind: 'upload', bytes, fileName }
}

function leaveQueueCall(body: unknown): LocalCall | null {
  const ids = jsonBody(body)?.['delete']
  if (!Array.isArray(ids) || ids.length === 0) return null
  const promptIds = ids.filter((id): id is string => typeof id === 'string' && PROMPT_ID.test(id))
  return promptIds.length === ids.length ? { kind: 'leave-queue', promptIds } : null
}

function interruptCall(body: unknown): LocalCall | null {
  const promptId = jsonBody(body)?.['prompt_id']
  return typeof promptId === 'string' && PROMPT_ID.test(promptId)
    ? { kind: 'interrupt', promptId }
    : null
}

function readPost(pathname: string, body: unknown, fileName: unknown): LocalCall | null {
  if (pathname === '/prompt') return promptCall(body)
  if (pathname === '/upload/image') return uploadCall(body, fileName)
  if (pathname === '/queue') return leaveQueueCall(body)
  if (pathname === '/interrupt') return interruptCall(body)
  return null
}

export function readLocalCall(raw: unknown): LocalCall | null {
  if (!isRecord(raw)) return null
  const { method = 'GET', path, body, fileName } = raw
  if (typeof path !== 'string') return null
  const queryAt = path.indexOf('?')
  const pathname = queryAt < 0 ? path : path.slice(0, queryAt)
  if (!PATHNAME.test(pathname)) return null
  const query = new URLSearchParams(queryAt < 0 ? '' : path.slice(queryAt + 1))
  if (method === 'GET') return readGet(pathname, query)
  if (method === 'POST') return readPost(pathname, body, fileName)
  return null
}

export function outputFilesOf(historyEntry: unknown): OutputFile[] {
  if (!isRecord(historyEntry) || !isRecord(historyEntry['outputs'])) return []
  const files: OutputFile[] = []
  for (const nodeOutput of Object.values(historyEntry['outputs'])) {
    if (!isRecord(nodeOutput)) continue
    for (const list of Object.values(nodeOutput)) {
      if (!Array.isArray(list)) continue
      for (const file of list) {
        if (!isRecord(file) || typeof file['filename'] !== 'string') continue
        files.push({
          filename: file['filename'],
          subfolder: typeof file['subfolder'] === 'string' ? file['subfolder'] : '',
          type: typeof file['type'] === 'string' ? file['type'] : 'output'
        })
      }
    }
  }
  return files
}

export function outputFileKey(file: OutputFile): string {
  return JSON.stringify([file.type, file.subfolder, file.filename])
}

export interface QueuedRun {
  n: number
  id: string | null
  app: string | null
  seconds: number | null
}

export interface QueueView {
  running: QueuedRun[]
  pending: QueuedRun[]
}

function appTagOf(extraData: unknown): Pick<QueuedRun, 'app' | 'seconds'> {
  const tag = isRecord(extraData) ? extraData['comfy_app'] : null
  if (!isRecord(tag)) return { app: null, seconds: null }
  const name = tag['name']
  const seconds = tag['seconds']
  return {
    app: typeof name === 'string' && name.length <= APP_NAME_MAX_CHARS ? name : null,
    seconds: typeof seconds === 'number' && seconds > 0 ? seconds : null
  }
}

function queuedRuns(list: unknown, isOwn: (promptId: string) => boolean): QueuedRun[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => {
      const promptId = typeof entry[1] === 'string' ? entry[1] : null
      return {
        n: typeof entry[0] === 'number' ? entry[0] : 0,
        id: promptId !== null && isOwn(promptId) ? promptId : null,
        ...appTagOf(entry[3])
      }
    })
    .sort((one, other) => one.n - other.n)
}

export function queueViewOf(queue: unknown, isOwn: (promptId: string) => boolean): QueueView {
  const body = isRecord(queue) ? queue : {}
  return {
    running: queuedRuns(body['queue_running'], isOwn),
    pending: queuedRuns(body['queue_pending'], isOwn)
  }
}
