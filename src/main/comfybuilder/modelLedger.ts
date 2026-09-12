import fs from 'fs'
import path from 'path'

import { writeFileSafeAsync } from '../lib/safe-file'

export const MODEL_LEDGER_VERSION = 1
export const MODEL_LEDGER_RELATIVE = path.join('ComfyUI', 'governance', 'model_ledger.json')

const MODEL_DIGEST = /^blake3:[0-9a-f]{64}$/
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/
const LEDGER_KEYS = ['ledgerVersion', 'entries'] as const
const ENTRY_KEYS = ['path', 'size', 'mtimeNs', 'inode', 'dev', 'digest'] as const

export interface ModelLedgerEntry {
  readonly path: string
  readonly size: number
  readonly mtimeNs: string
  readonly inode: string
  readonly dev: string
  readonly digest: string
}

export interface ModelLedger {
  readonly ledgerVersion: 1
  readonly entries: readonly ModelLedgerEntry[]
}

export function modelLedgerPath(installPath: string): string {
  return path.join(installPath, MODEL_LEDGER_RELATIVE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => key in value)
}

function isModelLedgerEntry(value: unknown): value is ModelLedgerEntry {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return false
  return (
    typeof value.path === 'string' &&
    path.isAbsolute(value.path) &&
    !value.path.includes('\\') &&
    typeof value.size === 'number' &&
    Number.isInteger(value.size) &&
    value.size >= 0 &&
    typeof value.mtimeNs === 'string' &&
    DECIMAL_INTEGER.test(value.mtimeNs) &&
    typeof value.inode === 'string' &&
    DECIMAL_INTEGER.test(value.inode) &&
    typeof value.dev === 'string' &&
    DECIMAL_INTEGER.test(value.dev) &&
    typeof value.digest === 'string' &&
    MODEL_DIGEST.test(value.digest)
  )
}

function isModelLedger(value: unknown): value is ModelLedger {
  if (!isRecord(value) || !hasExactKeys(value, LEDGER_KEYS)) return false
  return (
    value.ledgerVersion === MODEL_LEDGER_VERSION &&
    Array.isArray(value.entries) &&
    value.entries.every(isModelLedgerEntry)
  )
}

export async function readModelLedger(installPath: string): Promise<ModelLedger | null> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.promises.readFile(modelLedgerPath(installPath), 'utf-8')
    )
    return isModelLedger(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function createModelLedgerEntry(
  filePath: string,
  digest: string
): Promise<ModelLedgerEntry> {
  if (!MODEL_DIGEST.test(digest)) throw new Error(`Invalid model ledger digest: ${digest}`)

  const realPath = await fs.promises.realpath(filePath)
  const stat = await fs.promises.stat(realPath, { bigint: true })
  if (!stat.isFile()) throw new Error(`Model ledger path is not a file: ${realPath}`)
  if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Model is too large for the model ledger: ${realPath}`)
  }

  return {
    path: realPath.replace(/\\/g, '/'),
    size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(),
    inode: stat.ino.toString(),
    dev: stat.dev.toString(),
    digest
  }
}

export async function writeModelLedger(
  installPath: string,
  entries: readonly ModelLedgerEntry[]
): Promise<void> {
  const ledger: ModelLedger = { ledgerVersion: MODEL_LEDGER_VERSION, entries: [...entries] }
  if (!isModelLedger(ledger)) throw new Error('Refusing to write an invalid model ledger')
  await writeFileSafeAsync(modelLedgerPath(installPath), JSON.stringify(ledger))
}
