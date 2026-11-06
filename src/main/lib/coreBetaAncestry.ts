import fs from 'fs'
import path from 'path'
import {
  commitPresence,
  fetchCommitSha,
  findMergeBase,
  findMergeBaseOrNone,
  resolveGitDir,
  revParseRef
} from './git'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import { NO_CORE_COMMITS } from './coreBetaGrants'
import type { CoreCommitState } from './coreBetaGrants'
import type { CoreCheckout } from './version'

const FULL_SHA_RE = /^[0-9a-f]{40}$/

export const MAX_RESOLVED_SHAS = 16

const RESOLVE_BUDGET_MS = 10_000

const MAX_FETCHES = 2

const FAILED_FETCH_TTL_MS = 24 * 60 * 60 * 1000

type FailureStore = Record<string, { head: string; failed: Record<string, number> }>

const failuresPath = (): string => path.join(configDir(), 'core-beta-fetch-failures.json')

function readFailures(): FailureStore {
  const outcome = readFileSafe(failuresPath())
  if (outcome.kind !== 'data') return {}
  try {
    const parsed: unknown = JSON.parse(outcome.data)
    return parsed && typeof parsed === 'object' ? (parsed as FailureStore) : {}
  } catch {
    return {}
  }
}

function recordFailure(repoPath: string, head: string, sha: string): void {
  try {
    const store = readFailures()
    const entry = store[repoPath]?.head === head ? store[repoPath]! : { head, failed: {} }
    entry.failed[sha] = Date.now()
    store[repoPath] = entry
    writeFileSafe(failuresPath(), JSON.stringify(store))
  } catch (err) {
    console.warn('[core-beta] could not record a failed fetch:', err)
  }
}

const fetchChains = new Map<string, Promise<void>>()
const inFlight = new Set<string>()

export function _backgroundFetchesForTest(): Promise<unknown> {
  return Promise.all(fetchChains.values())
}

function scheduleFetch(repoPath: string, sha: string, head: string): boolean {
  const label = `[core-beta] fetch ${sha.slice(0, 12)}`
  const key = `${repoPath}\0${sha}`
  if (inFlight.has(key)) {
    console.log(`${label}: already in progress`)
    return false
  }
  const entry = readFailures()[repoPath]
  const failedAt = entry?.head === head ? entry.failed[sha] : undefined
  if (typeof failedAt === 'number' && Date.now() - failedAt < FAILED_FETCH_TTL_MS) {
    console.log(`${label}: skipped, failed at ${new Date(failedAt).toISOString()}`)
    return false
  }
  inFlight.add(key)
  console.log(`${label}: started in the background; unresolved for this launch`)
  const run = async (): Promise<void> => {
    const started = Date.now()
    const ok = await fetchCommitSha(repoPath, sha).catch(() => false)
    console.log(`${label} from origin: ${ok ? 'ok' : 'failed'} in ${Date.now() - started}ms`)
    if (!ok) recordFailure(repoPath, head, sha)
    inFlight.delete(key)
  }
  fetchChains.set(repoPath, (fetchChains.get(repoPath) ?? Promise.resolve()).then(run))
  return true
}

type Relation = boolean | null

export interface CommitProof {
  relation: Relation
  absentFromShallow: boolean
  notes: string[]
  error?: unknown
}

async function commitAncestry(
  repoPath: string,
  sha: string,
  head: string,
  complete: boolean,
  notes: string[]
): Promise<{ relation: Relation; absentFromShallow: boolean }> {
  const unproven = { relation: null, absentFromShallow: false }
  const base = await findMergeBaseOrNone(repoPath, sha, head)
  if (typeof base === 'string')
    return { relation: base.toLowerCase() === sha, absentFromShallow: false }
  if (base === null && complete) {
    notes.push(
      `[core-beta] ancestry ${sha.slice(0, 12)}: no common ancestor with HEAD in a full clone`
    )
    return { relation: false, absentFromShallow: false }
  }
  if ((await revParseRef(repoPath, `${head}^{commit}`))?.toLowerCase() !== head) return unproven
  if ((await commitPresence(repoPath, sha)) !== 'absent') return unproven
  if (complete) {
    notes.push(`[core-beta] ancestry ${sha.slice(0, 12)}: absent from a full clone`)
    return { relation: false, absentFromShallow: false }
  }
  return { relation: null, absentFromShallow: true }
}

export async function proveCommitRelation(
  repoPath: string,
  sha: string,
  head: string
): Promise<CommitProof> {
  const notes: string[] = []
  const grafts = readShallowGrafts(repoPath)
  let proof: { relation: Relation; absentFromShallow: boolean } = {
    relation: null,
    absentFromShallow: false
  }
  let error: unknown
  try {
    proof = await commitAncestry(repoPath, sha, head, grafts?.length === 0, notes)
  } catch (err) {
    error = err
  }
  if (proof.relation === false && grafts?.length !== 0) {
    const provable =
      grafts !== null &&
      (await notContainedHoldsOnShallow(repoPath, sha, grafts).catch(() => false))
    if (!provable) proof.relation = null
  }
  return { ...proof, notes, ...(error === undefined ? {} : { error }) }
}

const MAX_SHALLOW_GRAFTS = 8

function readShallowGrafts(repoPath: string): string[] | null {
  const gitDir = resolveGitDir(repoPath)
  if (gitDir === null) return null
  try {
    const commondir = path.join(gitDir, 'commondir')
    const common = fs.existsSync(commondir)
      ? path.resolve(gitDir, fs.readFileSync(commondir, 'utf-8').trim())
      : gitDir
    const file = path.join(common, 'shallow')
    try {
      fs.statSync(file)
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null
    }
    const grafts = fs
      .readFileSync(file, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0)
    return grafts.every((graft) => FULL_SHA_RE.test(graft)) ? grafts : null
  } catch {
    return null
  }
}

async function notContainedHoldsOnShallow(
  repoPath: string,
  sha: string,
  grafts: readonly string[]
): Promise<boolean> {
  if (grafts.length > MAX_SHALLOW_GRAFTS) return false
  for (const graft of grafts) {
    if (graft === sha) return false
    const base = await findMergeBase(repoPath, graft, sha)
    if (base?.toLowerCase() !== graft) return false
  }
  return true
}

export async function resolveCoreCommitState(
  repoPath: string,
  checkout: CoreCheckout,
  shas: readonly string[],
  signal?: AbortSignal
): Promise<CoreCommitState> {
  if (shas.length === 0 || checkout.kind !== 'head') return NO_CORE_COMMITS
  const head = checkout.commit.toLowerCase()
  if (!FULL_SHA_RE.test(head)) return NO_CORE_COMMITS
  const ancestry = new Map<string, boolean>()
  const deadline = Date.now() + RESOLVE_BUDGET_MS
  const budget = { fetches: 0, stopped: false }
  const work = (async () => {
    for (const [index, raw] of shas.entries()) {
      if (budget.stopped || signal?.aborted || Date.now() > deadline) return
      const sha = raw.toLowerCase()
      if (!FULL_SHA_RE.test(sha)) continue
      if (index >= MAX_RESOLVED_SHAS) {
        console.log(
          `[core-beta] ancestry ${sha.slice(0, 12)}: not checked (the payload names more than ${MAX_RESOLVED_SHAS} commits), so entries that need it do not match`
        )
        continue
      }
      const proof = await proveCommitRelation(repoPath, sha, head)
      if (proof.error !== undefined) {
        console.warn(`[core-beta] ancestry check failed for ${sha.slice(0, 12)}:`, proof.error)
      }
      for (const note of proof.notes) console.log(note)
      if (proof.absentFromShallow && !budget.stopped) {
        if (budget.fetches >= MAX_FETCHES) {
          console.log(`[core-beta] fetch ${sha.slice(0, 12)}: skipped, launch fetch budget spent`)
        } else if (scheduleFetch(repoPath, sha, head)) {
          budget.fetches += 1
        }
      }
      const related = proof.relation
      if (budget.stopped) return
      console.log(
        `[core-beta] ancestry ${sha.slice(0, 12)}: ${
          related === null
            ? 'unresolved (not provable on this checkout, so entries that need it do not match)'
            : related
              ? 'contained'
              : 'not contained'
        }`
      )
      if (related !== null) ancestry.set(sha, related)
    }
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<'interrupted'>((resolve) => {
    timer = setTimeout(() => resolve('interrupted'), Math.max(0, deadline - Date.now()))
    onAbort = () => resolve('interrupted')
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
  void work.catch((err: unknown) => console.warn('[core-beta] ancestry resolution failed:', err))
  try {
    const outcome = await Promise.race([
      work.then(
        () => 'done' as const,
        () => 'done' as const
      ),
      interrupted
    ])
    if (outcome === 'interrupted') {
      console.log('[core-beta] ancestry: stopped early; SHAs not reached stay unresolved')
    }
  } finally {
    budget.stopped = true
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
  return { head, ancestry }
}
