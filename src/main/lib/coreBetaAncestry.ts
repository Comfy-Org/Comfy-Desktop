import fs from 'fs'
import path from 'path'
import { fetchCommitSha, findMergeBase, resolveGitDir, revParseRef } from './git'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import { NO_CORE_COMMITS } from './coreBetaGrants'
import type { CoreCommitState } from './coreBetaGrants'
import type { CoreCheckout } from './version'

const FULL_SHA_RE = /^[0-9a-f]{40}$/

const MAX_RESOLVED_SHAS = 16

// Background fetches one launch may start.
const MAX_FETCHES = 2

// A failed fetch is not retried for this long on the same HEAD, across Desktop restarts, so a flag
// naming an unreachable SHA costs one attempt a day rather than one per launch.
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

// Chained per repository: concurrent fetches into one repository contend for its locks.
const fetchChains = new Map<string, Promise<void>>()
const inFlight = new Set<string>()

export function _backgroundFetchesForTest(): Promise<unknown> {
  return Promise.all(fetchChains.values())
}

/** Fetch `sha` in the background for the NEXT launch to use: this one never waits on the network. */
function scheduleFetch(repoPath: string, sha: string, head: string): void {
  const label = `[core-beta] fetch ${sha.slice(0, 12)}`
  const key = `${repoPath}\0${sha}`
  if (inFlight.has(key)) return console.log(`${label}: already in progress`)
  const entry = readFailures()[repoPath]
  const failedAt = entry?.head === head ? entry.failed[sha] : undefined
  if (typeof failedAt === 'number' && Date.now() - failedAt < FAILED_FETCH_TTL_MS) {
    return console.log(`${label}: skipped, failed at ${new Date(failedAt).toISOString()}`)
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
}

type Relation = boolean | null

// Not `isAncestorOf`: it answers `false` for "could not look", which would fail an upper bound open.
async function commitAncestry(
  repoPath: string,
  sha: string,
  head: string,
  complete: boolean,
  mayFetch: () => boolean
): Promise<Relation> {
  const base = await findMergeBase(repoPath, sha, head)
  if (base !== undefined) return base.toLowerCase() === sha
  // Absence counts only once the repository has been shown readable, by resolving HEAD itself.
  if ((await revParseRef(repoPath, `${head}^{commit}`))?.toLowerCase() !== head) return null
  if ((await revParseRef(repoPath, `${sha}^{commit}`)) !== undefined) return null
  // A complete clone holds every ancestor of HEAD, so a commit it lacks is not one of them.
  if (complete) {
    console.log(`[core-beta] ancestry ${sha.slice(0, 12)}: absent from a full clone`)
    return false
  }
  if (mayFetch()) scheduleFetch(repoPath, sha, head)
  else console.log(`[core-beta] fetch ${sha.slice(0, 12)}: skipped, launch fetch budget spent`)
  return null
}

/** More boundaries than this and a shallow "not contained" is left unproven rather than paid for. */
const MAX_SHALLOW_GRAFTS = 8

/** The shallow clone's graft commits: `[]` for a complete clone, `null` when that could not be
 *  established, which callers must treat as "shallow, boundaries unknown". */
function readShallowGrafts(repoPath: string): string[] | null {
  const gitDir = resolveGitDir(repoPath)
  if (gitDir === null) return null
  const file = path.join(gitDir, 'shallow')
  try {
    if (!fs.existsSync(file)) return []
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

// On a truncated graph a merge-base other than `sha` does not by itself prove HEAD lacks `sha`: the
// real path to it may run below a graft. It does once every graft is a proper ancestor of `sha`: a
// path crossing graft `g` would make `sha` an ancestor of `g`, so the local graph is complete between
// HEAD and anything newer than all the boundaries.
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
  const grafts = readShallowGrafts(repoPath)
  const ancestry = new Map<string, boolean>()
  let fetches = 0
  for (const [index, sha] of shas.entries()) {
    if (signal?.aborted) break
    let related: Relation = null
    if (index < MAX_RESOLVED_SHAS) {
      try {
        related = await commitAncestry(repoPath, sha, head, grafts?.length === 0, () => {
          fetches += 1
          return fetches <= MAX_FETCHES
        })
      } catch (err) {
        console.warn(`[core-beta] ancestry check failed for ${sha.slice(0, 12)}:`, err)
      }
      if (related === false && grafts?.length !== 0) {
        const provable =
          grafts !== null &&
          (await notContainedHoldsOnShallow(repoPath, sha, grafts).catch(() => false))
        if (!provable) related = null
      }
    }
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
  return { head, ancestry }
}
