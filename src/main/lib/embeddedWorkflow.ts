import { inflateSync } from 'node:zlib'

import { isApiWorkflow } from '../apps/openRequest'

export type EmbeddedWorkflow =
  | { format: 'graph'; data: Record<string, unknown> }
  | { format: 'api'; data: Record<string, unknown> }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_JSON_BYTES = 8_000_000
const SCAN_BUDGET_BYTES = 64_000_000
const MAX_INFLATED_BYTES = 16_000_000
const MAX_GRAPH_NODES = 5_000
const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const QUOTE = 0x22
const BACKSLASH = 0x5c
const utf8 = new TextDecoder('utf-8', { fatal: false })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGraphNode(value: unknown): boolean {
  return isRecord(value) && typeof value['type'] === 'string' && value['id'] !== undefined
}

export function isGraphWorkflow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const nodes = value['nodes']
  return (
    Array.isArray(nodes) &&
    nodes.length > 0 &&
    nodes.length <= MAX_GRAPH_NODES &&
    nodes.every(isGraphNode)
  )
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

interface Found {
  graph: Record<string, unknown> | null
  api: Record<string, unknown> | null
}

function collect(value: unknown, found: Found, depth = 0): void {
  if (typeof value === 'string' && depth > 0) {
    collect(parseJson(value), found, depth)
    return
  }
  if (!isRecord(value)) return
  if (isGraphWorkflow(value)) {
    found.graph ??= value
    return
  }
  if (isApiWorkflow(value)) {
    found.api ??= value
    return
  }
  if (depth >= 2) return
  for (const key of ['workflow', 'prompt']) collect(value[key], found, depth + 1)
}

function bestOf(found: Found): EmbeddedWorkflow | null {
  if (found.graph) return { format: 'graph', data: found.graph }
  if (found.api) return { format: 'api', data: found.api }
  return null
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  )
}

function latin1(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}

function inflated(bytes: Uint8Array): Uint8Array | null {
  try {
    return inflateSync(bytes, { maxOutputLength: MAX_INFLATED_BYTES })
  } catch {
    return null
  }
}

function textChunk(type: string, data: Uint8Array): { key: string; text: string } | null {
  const keyEnd = data.indexOf(0)
  if (keyEnd <= 0) return null
  const key = latin1(data.subarray(0, keyEnd)).toLowerCase()
  if (type === 'tEXt') return { key, text: utf8.decode(data.subarray(keyEnd + 1)) }
  if (type === 'zTXt') {
    const body = inflated(data.subarray(keyEnd + 2))
    return body ? { key, text: utf8.decode(body) } : null
  }
  const compressed = data[keyEnd + 1] === 1
  const languageEnd = data.indexOf(0, keyEnd + 3)
  const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1)
  if (translatedEnd < 0) return null
  const raw = data.subarray(translatedEnd + 1)
  const body = compressed ? inflated(raw) : raw
  return body ? { key, text: utf8.decode(body) } : null
}

function fromPng(bytes: Uint8Array): EmbeddedWorkflow | null {
  const found: Found = { graph: null, api: null }
  let at = PNG_SIGNATURE.length
  while (at + 8 <= bytes.length) {
    const length = readUint32(bytes, at)
    const type = latin1(bytes.subarray(at + 4, at + 8))
    const start = at + 8
    if (type === 'IDAT' || type === 'IEND' || start + length > bytes.length) break
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const chunk = textChunk(type, bytes.subarray(start, start + length))
      if (chunk && (chunk.key === 'workflow' || chunk.key === 'prompt')) {
        collect(parseJson(chunk.text), found)
      }
    }
    at = start + length + 4
  }
  return bestOf(found)
}

function isBinaryOutsideString(byte: number): boolean {
  return byte >= 0x80 || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)
}

interface ScanBudget {
  left: number
}

function jsonEnd(bytes: Uint8Array, start: number, budget: ScanBudget): number {
  let depth = 0
  let inString = false
  const limit = Math.min(bytes.length, start + MAX_JSON_BYTES)
  for (let i = start; i < limit; i++) {
    if (--budget.left < 0) return -1
    const byte = bytes[i]!
    if (inString) {
      if (byte === BACKSLASH) i++
      else if (byte === QUOTE) inString = false
      else if (byte < 0x20) return -1
      continue
    }
    if (isBinaryOutsideString(byte)) return -1
    if (byte === QUOTE) inString = true
    else if (byte === OPEN_BRACE) depth++
    else if (byte === CLOSE_BRACE && --depth === 0) return i + 1
  }
  return -1
}

function startsObject(bytes: Uint8Array, at: number): boolean {
  let next = at + 1
  while (bytes[next] === 0x20 || bytes[next] === 0x0a || bytes[next] === 0x0d) next++
  return bytes[next] === QUOTE
}

function fromAnyBytes(bytes: Uint8Array, budget: ScanBudget): EmbeddedWorkflow | null {
  const found: Found = { graph: null, api: null }
  let at = bytes.indexOf(OPEN_BRACE)
  while (at >= 0 && !found.graph && budget.left > 0) {
    const end = startsObject(bytes, at) ? jsonEnd(bytes, at, budget) : -1
    const value = end > at ? parseJson(utf8.decode(bytes.subarray(at, end))) : undefined
    if (value !== undefined) collect(value, found)
    at = bytes.indexOf(OPEN_BRACE, value === undefined ? at + 1 : end)
  }
  return bestOf(found)
}

export function readEmbeddedWorkflow(parts: Uint8Array[]): EmbeddedWorkflow | null {
  const [head] = parts
  if (head && isPng(head)) return fromPng(head)
  const budget = { left: SCAN_BUDGET_BYTES }
  for (const part of parts) {
    const workflow = fromAnyBytes(part, budget)
    if (workflow) return workflow
  }
  return null
}
