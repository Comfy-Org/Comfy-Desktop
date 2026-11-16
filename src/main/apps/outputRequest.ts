import type { AppOutput, AppOutputAction, AppOutputs } from '../../types/ipc'

export const MAX_OUTPUTS = 40
export const MAX_OUTPUTS_BYTES = 100_000_000
const MAX_NAME_LENGTH = 200
const MAX_TAGS = 8
const MAX_TAG_LENGTH = 40
const SHOWN_MEDIA_TYPE =
  /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|webm|flac|aac))$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function readOutput(value: unknown): AppOutput | null {
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
    workflow: value['workflow'] === true
  }
}

export function readOutputRequest(raw: unknown): AppOutputs | null {
  if (!isRecord(raw)) return null
  const { items, index } = raw
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_OUTPUTS) return null
  if (!isIndex(index) || index >= items.length) return null
  const outputs = Array.from(items, readOutput)
  if (outputs.some((output) => output === null)) return null
  const shown = outputs as AppOutput[]
  const sentBytes = shown.reduce((sum, output) => sum + output.bytes.buffer.byteLength, 0)
  return sentBytes > MAX_OUTPUTS_BYTES ? null : { items: shown, index }
}

export function readOutputAction(raw: unknown): AppOutputAction | null {
  if (!isRecord(raw)) return null
  const { action, index } = raw
  if (action !== 'download' && action !== 'open-workflow') return null
  return isIndex(index) ? { action, index } : null
}
