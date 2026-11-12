import type { AppOutputAction, AppOutputItem } from '../../types/ipc'

export const MAX_OUTPUTS = 40
export const MAX_OUTPUTS_BYTES = 100_000_000
const MAX_TAGS = 8
const MEDIA_TYPE =
  /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|webm|flac|aac))$/

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null
}

const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/

function hasHiddenCharacters(value: string): boolean {
  return (
    BIDI_CONTROLS.test(value) ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
}
const ABSOLUTE_LOCAL_PATH = /^(\/|[A-Za-z]:[\\/])/

function absoluteFolder(value: unknown): string | null {
  const folder = text(value, 1024)
  if (!folder || hasHiddenCharacters(folder)) return null
  return ABSOLUTE_LOCAL_PATH.test(folder) ? folder : null
}

function outputItem(value: unknown): AppOutputItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const name = text(item['name'], 200)
  const mimeType = item['mimeType']
  const bytes = item['bytes']
  if (!name || typeof mimeType !== 'string' || !MEDIA_TYPE.test(mimeType)) return null
  if (!(bytes instanceof Uint8Array)) return null
  const tags = Array.isArray(item['tags'])
    ? item['tags']
        .slice(0, MAX_TAGS)
        .map((tag) => text(tag, 40))
        .filter((tag): tag is string => tag !== null)
    : []
  const savedOn =
    item['savedOn'] === 'cloud' || item['savedOn'] === 'computer' ? item['savedOn'] : null
  const folder = savedOn === 'computer' ? absoluteFolder(item['folder']) : null
  return {
    name,
    mimeType,
    bytes: bytes as Uint8Array<ArrayBuffer>,
    tags,
    workflow: item['workflow'] === true,
    ...(savedOn ? { savedOn } : {}),
    ...(folder ? { folder } : {})
  }
}

export function outputRequest(input: unknown): { items: AppOutputItem[]; index: number } | null {
  if (!input || typeof input !== 'object') return null
  const { items, index } = input as { items?: unknown; index?: unknown }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_OUTPUTS) return null
  const parsed = items.map(outputItem)
  if (parsed.some((item) => item === null)) return null
  const outputs = parsed as AppOutputItem[]
  const total = outputs.reduce((sum, item) => sum + item.bytes.byteLength, 0)
  if (total > MAX_OUTPUTS_BYTES) return null
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
  return index < outputs.length ? { items: outputs, index } : null
}

export function outputAction(input: unknown): AppOutputAction | null {
  if (!input || typeof input !== 'object') return null
  const { action, index } = input as { action?: unknown; index?: unknown }
  if (action !== 'download' && action !== 'open-workflow' && action !== 'show-in-folder')
    return null
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
  return { action, index }
}
