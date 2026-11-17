import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'
import { stateDir } from './paths'

export const OUTPUT_JOURNAL_ENV = 'COMFYUI_OUTPUT_JOURNAL_DIR'
export const OUTPUT_PRODUCER_ENV = 'COMFYUI_OUTPUT_PRODUCER_ID'

const JOURNAL_NAME = /^\d+-[a-f0-9]{32}\.jsonl$/
const DECIMAL = /^(?:0|[1-9]\d{0,19})$/
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d{0,19})$/
const REVISION = /^\d{1,20}:\d{1,20}:\d{1,20}:-?\d{1,20}$/
const MAX_LINE_BYTES = 64 * 1024
const ASSET_ID_PREFIX = 'output-revision:'

type RevisionsByPath = Map<string, Set<string>>

interface Journal {
  identity: string
  offset: number
  outputs: RevisionsByPath
  incomplete: boolean
}

interface BuildOutputs {
  outputs: RevisionsByPath
  incomplete: boolean
}

export function outputJournalDirectory(installationId: string): string {
  const key = createHash('sha256').update(installationId).digest('hex')
  return path.join(stateDir(), 'output-provenance', key)
}

function identity(stat: BigIntStats): string {
  return `${BigInt.asUintN(64, stat.dev)}:${BigInt.asUintN(64, stat.ino)}`
}

export function outputRevision(stat: BigIntStats): string | null {
  return stat.isFile() && stat.ino !== 0n ? `${identity(stat)}:${stat.size}:${stat.mtimeNs}` : null
}

export function outputAssetId(file: string, revision: string): string {
  return ASSET_ID_PREFIX + Buffer.from(`${file}\0${revision}`).toString('base64url')
}

export function outputReference(id: string): { file: string; revision?: string } | null {
  if (!id.startsWith(ASSET_ID_PREFIX)) return { file: id }
  const [file, revision, extra] = Buffer.from(id.slice(ASSET_ID_PREFIX.length), 'base64url')
    .toString()
    .split('\0')
  return file && revision && extra === undefined && REVISION.test(revision)
    ? { file, revision }
    : null
}

function includeRecord(line: Buffer, producerId: string, outputs: RevisionsByPath): boolean {
  let value: unknown
  try {
    value = JSON.parse(line.toString())
  } catch {
    return false
  }
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.version !== 1 || record.producer_id !== producerId) return false
  const { path: file, device, inode, size, mtime_ns: mtime } = record
  if (
    typeof file !== 'string' ||
    !path.isAbsolute(file) ||
    file.includes('\0') ||
    typeof device !== 'string' ||
    !DECIMAL.test(device) ||
    typeof inode !== 'string' ||
    !DECIMAL.test(inode) ||
    inode === '0' ||
    typeof size !== 'string' ||
    !DECIMAL.test(size) ||
    typeof mtime !== 'string' ||
    !SIGNED_DECIMAL.test(mtime)
  )
    return false

  const existing = outputs.get(file) ?? new Set<string>()
  existing.add(`${device}:${inode}:${size}:${mtime}`)
  outputs.set(file, existing)
  return true
}

async function readJournal(
  file: string,
  producerId: string,
  journals: Map<string, Journal>
): Promise<boolean> {
  const handle = await open(file, 'r')
  try {
    const stat = await handle.stat({ bigint: true })
    if (!stat.isFile()) {
      journals.delete(file)
      return false
    }
    const end = Number(stat.size)
    const id = identity(stat)
    let journal = journals.get(file)
    if (!journal || journal.identity !== id || journal.offset > end) {
      journal = { identity: id, offset: 0, outputs: new Map(), incomplete: false }
      journals.set(file, journal)
    }
    if (journal.offset === end) return true

    let consumed = journal.offset
    let remainder = Buffer.alloc(0)
    let oversized = false
    for await (const buffer of handle.createReadStream({
      start: consumed,
      end: end - 1,
      autoClose: false
    })) {
      const chunk: Buffer = buffer
      let offset = 0
      for (let newline = chunk.indexOf(10); newline >= 0; newline = chunk.indexOf(10, offset)) {
        const part = chunk.subarray(offset, newline)
        if (
          oversized ||
          remainder.length + part.length > MAX_LINE_BYTES ||
          !includeRecord(Buffer.concat([remainder, part]), producerId, journal.outputs)
        ) {
          journal.incomplete = true
        }
        offset = newline + 1
        journal.offset = consumed + offset
        remainder = Buffer.alloc(0)
        oversized = false
      }
      const tail = chunk.subarray(offset)
      oversized ||= remainder.length + tail.length > MAX_LINE_BYTES
      if (!oversized) remainder = Buffer.concat([remainder, tail])
      consumed += chunk.length
    }
    return true
  } finally {
    await handle.close()
  }
}

const journalsByProducer = new Map<string, Map<string, Journal>>()
const pendingByProducer = new Map<string, Promise<BuildOutputs>>()

async function readBuildOutputs(producerId: string): Promise<BuildOutputs> {
  const directory = outputJournalDirectory(producerId)
  let incomplete = false
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (!error.code) throw error
      incomplete = error.code !== 'ENOENT'
      return []
    }
  )
  const files = entries
    .filter((entry) => entry.isFile() && JOURNAL_NAME.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
  const journals = journalsByProducer.get(directory) ?? new Map<string, Journal>()
  journalsByProducer.set(directory, journals)
  const active = new Set(files)
  for (const file of journals.keys()) if (!active.has(file)) journals.delete(file)
  for (const file of files) {
    const readable = await readJournal(file, producerId, journals).catch(
      (error: NodeJS.ErrnoException) => {
        if (!error.code) throw error
        journals.delete(file)
        return error.code === 'ENOENT'
      }
    )
    if (!readable) incomplete = true
  }
  const outputs: RevisionsByPath = new Map()
  for (const journal of journals.values()) {
    if (journal.incomplete) incomplete = true
    for (const [file, revisions] of journal.outputs) {
      const versions = outputs.get(file)
      if (versions) for (const revision of revisions) versions.add(revision)
      else outputs.set(file, new Set(revisions))
    }
  }
  return { outputs, incomplete }
}

export function readOutputProvenance(producerId: string): Promise<BuildOutputs> {
  const directory = outputJournalDirectory(producerId)
  const pending = pendingByProducer.get(directory)
  if (pending) return pending
  const reading = readBuildOutputs(producerId).finally(() => pendingByProducer.delete(directory))
  pendingByProducer.set(directory, reading)
  return reading
}
