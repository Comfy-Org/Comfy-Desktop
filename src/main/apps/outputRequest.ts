import type { AppOutput, AppOutputAction, AppOutputs } from '../../types/ipc'

export interface ComfyOutputFile {
  filename: string
  subfolder: string
}

export interface RequestedOutput extends AppOutput {
  comfyFile?: ComfyOutputFile
}

export interface OutputRequest extends Omit<AppOutputs, 'items'> {
  items: RequestedOutput[]
}

export const MAX_OUTPUTS = 40
export const MAX_OUTPUTS_BYTES = 100_000_000
const MAX_NAME_LENGTH = 200
const MAX_TAGS = 8
const MAX_TAG_LENGTH = 40
const MAX_FOLDER_LENGTH = 1024
const MAX_FILENAME_LENGTH = 255
const ABSOLUTE_LOCAL_PATH = /^(\/|[A-Za-z]:[\\/])/
const PATH_SEPARATOR = /[\\/]/
const BIDI_CONTROL = /[\u202a-\u202e\u2066-\u2069]/
const FIRST_PRINTABLE_CODE = 32
const DELETE_CODE = 127
const ACTIONS: readonly unknown[] = ['download', 'open-workflow', 'show-in-folder']
const SHOWN_MEDIA_TYPE =
  /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|webm|flac|aac))$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAction(value: unknown): value is AppOutputAction['action'] {
  return ACTIONS.includes(value)
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function trimmed(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_TAGS)
    .map((tag) => trimmed(tag, MAX_TAG_LENGTH))
    .filter((tag): tag is string => tag !== null)
}

function hasHiddenCharacters(value: string): boolean {
  return (
    BIDI_CONTROL.test(value) ||
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0)
      return code < FIRST_PRINTABLE_CODE || code === DELETE_CODE
    })
  )
}

function readFolder(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_FOLDER_LENGTH) return null
  if (hasHiddenCharacters(value)) return null
  return ABSOLUTE_LOCAL_PATH.test(value) ? value : null
}

function isPathPart(value: string): boolean {
  return value !== '' && value !== '.' && value !== '..' && value.trim() === value
}

function readComfyFile(value: unknown): ComfyOutputFile | null {
  if (!isRecord(value)) return null
  const { filename, subfolder = '', type } = value
  if (type !== 'output' || typeof filename !== 'string' || typeof subfolder !== 'string') {
    return null
  }
  if (filename.length > MAX_FILENAME_LENGTH || PATH_SEPARATOR.test(filename)) return null
  if (!isPathPart(filename) || hasHiddenCharacters(filename + subfolder)) return null
  if (subfolder.length > MAX_FOLDER_LENGTH || ABSOLUTE_LOCAL_PATH.test(subfolder)) return null
  const parts = subfolder === '' ? [] : subfolder.split(PATH_SEPARATOR)
  return parts.every(isPathPart) ? { filename, subfolder: parts.join('/') } : null
}

function readSavedPlace(value: Record<string, unknown>): Partial<RequestedOutput> {
  const savedOn = value['savedOn']
  if (savedOn === 'cloud') return { savedOn }
  if (savedOn !== 'computer') return {}
  const folder = readFolder(value['folder'])
  const comfyFile = readComfyFile(value['comfyFile'])
  return { savedOn, ...(folder ? { folder } : {}), ...(comfyFile ? { comfyFile } : {}) }
}

function readOutput(value: unknown): RequestedOutput | null {
  if (!isRecord(value)) return null
  const name = trimmed(value['name'], MAX_NAME_LENGTH)
  const { mimeType, bytes } = value
  if (!name || typeof mimeType !== 'string' || !SHOWN_MEDIA_TYPE.test(mimeType)) return null
  if (!(bytes instanceof Uint8Array)) return null
  return {
    name,
    mimeType,
    bytes: bytes as Uint8Array<ArrayBuffer>,
    tags: readTags(value['tags']),
    workflow: value['workflow'] === true,
    ...readSavedPlace(value)
  }
}

export function readOutputRequest(raw: unknown): OutputRequest | null {
  if (!isRecord(raw)) return null
  const { items, index } = raw
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_OUTPUTS) return null
  if (!isIndex(index) || index >= items.length) return null
  const outputs = Array.from(items, readOutput)
  if (outputs.some((output) => output === null)) return null
  const shown = outputs as RequestedOutput[]
  const sentBytes = shown.reduce((sum, output) => sum + output.bytes.buffer.byteLength, 0)
  return sentBytes > MAX_OUTPUTS_BYTES ? null : { items: shown, index }
}

export function readOutputAction(raw: unknown): AppOutputAction | null {
  if (!isRecord(raw)) return null
  const { action, index } = raw
  return isAction(action) && isIndex(index) ? { action, index } : null
}
