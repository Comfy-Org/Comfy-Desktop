import { inflateSync } from 'node:zlib'

import { isApiWorkflow } from '../apps/openRequest'

export type EmbeddedWorkflow =
  | { format: 'graph'; data: Record<string, unknown> }
  | { format: 'api'; data: Record<string, unknown> }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_JSON_BYTES = 8_000_000
const SCAN_BUDGET_BYTES = 64_000_000
const MAX_INFLATED_BYTES = 16_000_000
const TEXT_CHUNKS: ReadonlySet<string> = new Set(['tEXt', 'zTXt', 'iTXt', 'comf'])
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
  if (!Array.isArray(nodes) || nodes.length === 0) return false
  if (nodes.length > MAX_GRAPH_NODES) {
    console.warn(
      `Skipped a saved workflow with ${nodes.length} nodes; the limit is ${MAX_GRAPH_NODES}.`
    )
    return false
  }
  return nodes.every(isGraphNode)
}

const NON_FINITE_TOKENS = ['-Infinity', 'Infinity', 'NaN']
const TOKEN_BEFORE = /[\w.-]/
const TOKEN_AFTER = /[\w.]/

function bareTokenAt(text: string, at: number): string | null {
  if (TOKEN_BEFORE.test(text[at - 1] ?? '')) return null
  const token = NON_FINITE_TOKENS.find((candidate) => text.startsWith(candidate, at))
  if (!token || TOKEN_AFTER.test(text[at + token.length] ?? '')) return null
  return token
}

function withoutNonFinite(text: string): string {
  const parts: string[] = []
  let copiedTo = 0
  let inString = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (inString) {
      if (char === '\\') at++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    const token = bareTokenAt(text, at)
    if (!token) continue
    parts.push(text.slice(copiedTo, at), 'null')
    at += token.length - 1
    copiedTo = at + 1
  }
  parts.push(text.slice(copiedTo))
  return parts.join('')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    try {
      return JSON.parse(withoutNonFinite(text))
    } catch {
      return undefined
    }
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

interface InflateBudget {
  left: number
}

function isZlibHeader(bytes: Uint8Array): boolean {
  const [method, flags] = bytes
  if (method === undefined || flags === undefined) return false
  const deflate = (method & 0x0f) === 8 && method >> 4 <= 7
  const presetDictionary = (flags & 0x20) !== 0
  return deflate && !presetDictionary && ((method << 8) | flags) % 31 === 0
}

function inflated(bytes: Uint8Array, budget: InflateBudget): Uint8Array | null {
  if (budget.left <= 0 || !isZlibHeader(bytes)) return null
  try {
    const body = inflateSync(bytes, { maxOutputLength: budget.left })
    budget.left -= body.length
    return body
  } catch {
    budget.left = 0
    return null
  }
}

function chunkKey(data: Uint8Array): { key: string; keyEnd: number } | null {
  const keyEnd = data.indexOf(0)
  return keyEnd > 0 ? { key: latin1(data.subarray(0, keyEnd)).toLowerCase(), keyEnd } : null
}

function chunkText(
  type: string,
  data: Uint8Array,
  keyEnd: number,
  budget: InflateBudget
): string | null {
  if (type === 'tEXt' || type === 'comf') return utf8.decode(data.subarray(keyEnd + 1))
  if (type === 'zTXt') {
    const body = inflated(data.subarray(keyEnd + 2), budget)
    return body ? utf8.decode(body) : null
  }
  const compressed = data[keyEnd + 1] === 1
  const languageEnd = data.indexOf(0, keyEnd + 3)
  const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1)
  if (translatedEnd < 0) return null
  const raw = data.subarray(translatedEnd + 1)
  const body = compressed ? inflated(raw, budget) : raw
  return body ? utf8.decode(body) : null
}

function fromPng(bytes: Uint8Array): EmbeddedWorkflow | null {
  const found: Found = { graph: null, api: null }
  const budget = { left: MAX_INFLATED_BYTES }
  let at = PNG_SIGNATURE.length
  while (at + 8 <= bytes.length) {
    const length = readUint32(bytes, at)
    const type = latin1(bytes.subarray(at + 4, at + 8))
    const start = at + 8
    if (type === 'IEND' || start + length > bytes.length) break
    if (TEXT_CHUNKS.has(type)) {
      const data = bytes.subarray(start, start + length)
      const named = chunkKey(data)
      const text =
        named && (named.key === 'workflow' || named.key === 'prompt')
          ? chunkText(type, data, named.keyEnd, budget)
          : null
      if (text !== null) collect(parseJson(text), found)
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
  while ([0x20, 0x09, 0x0a, 0x0d].includes(bytes[next]!)) next++
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
  const [head, ...rest] = parts
  if (!head) return null
  const png = isPng(head)
  const fromHead = png ? fromPng(head) : null
  if (fromHead?.format === 'graph') return fromHead
  const budget = { left: SCAN_BUDGET_BYTES }
  let prompt: EmbeddedWorkflow | null = fromHead
  for (const part of png ? rest : parts) {
    const workflow = fromAnyBytes(part, budget)
    if (workflow?.format === 'graph') return workflow
    prompt ??= workflow
  }
  return prompt
}
