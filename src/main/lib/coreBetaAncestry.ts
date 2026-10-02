import fs from 'fs'
import path from 'path'
import {
  commitPresence,
  fetchCommitSha,
  findMergeBase,
  findMergeBaseOrNone,
  isPygit2Configured,
  resolveGitDir,
  revParseRef
} from './git'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import { NO_CORE_COMMITS } from './coreBetaGrants'
import type { CoreCommitState } from './coreBetaGrants'
import type { CoreCheckout } from './version'

const FULL_SHA_RE = /^[0-9a-f]{40}$/

const MAX_RESOLVED_SHAS = 16

// All git work for one launch, which runs before spawn; SHAs not reached in time stay unresolved.
const RESOLVE_BUDGET_MS = 10_000

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

/** Relations proven by resolutions in this process, keyed by repository, HEAD and SHA. On a host
 *  whose git is a Python spawn per call (pygit2) a display-only resolution answers from here instead
 *  of from git; a moved HEAD simply misses. Each resolution also evicts whatever it could not prove,
 *  so the cache holds the LAST resolution's answer, never one it has since withheld. */
const provenRelations = new Map<string, boolean>()
const relationKey = (repoPath: string, head: string, sha: string): string =>
  `${repoPath}\0${head}\0${sha}`

export function _resetProvenRelationsForTest(): void {
  provenRelations.clear()
}

/** One resolution's shared state. `fetch` and `log` are the launch's defaults unless a caller
 *  resolving for display turns them off. */
interface ResolveBudget {
  fetches: number
  stopped: boolean
  fetch: boolean
  log: (message: string) => void
}

// Not `isAncestorOf`: it answers `false` for "could not look", which would fail an upper bound open.
async function commitAncestry(
  repoPath: string,
  sha: string,
  head: string,
  complete: boolean,
  budget: ResolveBudget
): Promise<Relation> {
  const base = await findMergeBaseOrNone(repoPath, sha, head)
  if (typeof base === 'string') return base.toLowerCase() === sha
  // Both commits resolved and share nothing: on a complete graph HEAD cannot contain `sha`. A shallow
  // graph may just be cut short, and the graft rule cannot hold without a common ancestor.
  if (base === null && complete) {
    budget.log(
      `[core-beta] ancestry ${sha.slice(0, 12)}: no common ancestor with HEAD in a full clone`
    )
    return false
  }
  // Absence counts only once the repository has been shown readable, by resolving HEAD itself.
  if ((await revParseRef(repoPath, `${head}^{commit}`))?.toLowerCase() !== head) return null
  if ((await commitPresence(repoPath, sha)) !== 'absent') return null
  // A complete clone holds every ancestor of HEAD, so a commit it lacks is not one of them.
  if (complete) {
    budget.log(`[core-beta] ancestry ${sha.slice(0, 12)}: absent from a full clone`)
    return false
  }
  if (budget.stopped || !budget.fetch) return null
  if (budget.fetches >= MAX_FETCHES) {
    budget.log(`[core-beta] fetch ${sha.slice(0, 12)}: skipped, launch fetch budget spent`)
  } else if (scheduleFetch(repoPath, sha, head)) {
    budget.fetches += 1
  }
  return null
}

/** More boundaries than this and a shallow "not contained" is left unproven rather than paid for. */
const MAX_SHALLOW_GRAFTS = 8

/** The shallow clone's graft commits: `[]` for a complete clone, `null` when that could not be
 *  established, which callers must treat as "shallow, boundaries unknown". */
function readShallowGrafts(repoPath: string): string[] | null {
  const gitDir = resolveGitDir(repoPath)
  if (gitDir === null) return null
  try {
    // `shallow` is shared by all worktrees, so a linked worktree's lives in the common dir.
    const commondir = path.join(gitDir, 'commondir')
    const common = fs.existsSync(commondir)
      ? path.resolve(gitDir, fs.readFileSync(commondir, 'utf-8').trim())
      : gitDir
    const file = path.join(common, 'shallow')
    try {
      fs.statSync(file)
    } catch (err) {
      // Only a proven absence means a complete clone; any other failure is "could not look".
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
    // `findMergeBase`, not `findMergeBaseOrNone`: here "no common ancestor" and "could not look" both
    // mean the graft is not proven an ancestor, and both must fail.
    const base = await findMergeBase(repoPath, graft, sha)
    if (base?.toLowerCase() !== graft) return false
  }
  return true
}

export async function resolveCoreCommitState(
  repoPath: string,
  checkout: CoreCheckout,
  shas: readonly string[],
  signal?: AbortSignal,
  /** Display-only resolution: `fetch: false` never schedules a background fetch (so it writes
   *  nothing, to the repository or the failure record), and `quiet` drops the per-SHA log lines.
   *  An ancestry a fetch could have settled stays unresolved, exactly as it is for the launch
   *  that schedules that fetch. `budgetMs` shortens the launch's time budget for a caller that
   *  must not hold its UI. `avoidPygit2`, on a host whose git runs through the pygit2 fallback
   *  (every call a Python spawn), answers only from relations an earlier resolution in this
   *  process proved, typically the last launch. `onIncomplete` fires when SHAs were left
   *  unresolved for a reason a later call might not share: the time budget, `signal`, or an
   *  `avoidPygit2` lookup that missed. */
  options: {
    fetch?: boolean
    quiet?: boolean
    budgetMs?: number
    avoidPygit2?: boolean
    onIncomplete?: () => void
  } = {}
): Promise<CoreCommitState> {
  if (shas.length === 0 || checkout.kind !== 'head') return NO_CORE_COMMITS
  const head = checkout.commit.toLowerCase()
  if (!FULL_SHA_RE.test(head)) return NO_CORE_COMMITS
  if (options.avoidPygit2 && isPygit2Configured()) {
    const known = new Map<string, boolean>()
    for (const [index, raw] of shas.entries()) {
      const sha = raw.toLowerCase()
      // Skipped exactly as the resolving loop below skips them, so the answers agree.
      if (!FULL_SHA_RE.test(sha) || index >= MAX_RESOLVED_SHAS) continue
      const related = provenRelations.get(relationKey(repoPath, head, sha))
      if (related === undefined) {
        options.onIncomplete?.()
        return NO_CORE_COMMITS
      }
      known.set(sha, related)
    }
    return { head, ancestry: known }
  }
  const ancestry = new Map<string, boolean>()
  const deadline = Date.now() + (options.budgetMs ?? RESOLVE_BUDGET_MS)
  const log = options.quiet ? () => {} : (message: string) => console.log(message)
  const warn = options.quiet
    ? () => {}
    : (message: string, err: unknown) => console.warn(message, err)
  const budget: ResolveBudget = { fetches: 0, stopped: false, fetch: options.fetch !== false, log }
  // Set when the loop itself notices the deadline or the abort between two SHAs (which can settle
  // `work` before the race's own timer or abort listener fires), or when a check throws.
  let cutShort = false
  const work = (async () => {
    for (const [index, raw] of shas.entries()) {
      if (budget.stopped || signal?.aborted || Date.now() > deadline) {
        if (!budget.stopped) cutShort = true
        return
      }
      // Re-validated here, not only at parse time: the SHA reaches `git fetch` as an argument.
      const sha = raw.toLowerCase()
      if (!FULL_SHA_RE.test(sha)) continue
      if (index >= MAX_RESOLVED_SHAS) {
        log(
          `[core-beta] ancestry ${sha.slice(0, 12)}: not checked (the payload names more than ${MAX_RESOLVED_SHAS} commits), so entries that need it do not match`
        )
        continue
      }
      // Re-read per SHA: a background fetch from an earlier launch can rewrite the boundaries.
      const grafts = readShallowGrafts(repoPath)
      let related: Relation = null
      try {
        related = await commitAncestry(repoPath, sha, head, grafts?.length === 0, budget)
      } catch (err) {
        warn(`[core-beta] ancestry check failed for ${sha.slice(0, 12)}:`, err)
        // A thrown check is a transient failure, not an answer about the commits: report the
        // resolution as incomplete rather than as a definite "unresolved".
        cutShort = true
      }
      if (related === false && grafts?.length !== 0) {
        const provable =
          grafts !== null &&
          (await notContainedHoldsOnShallow(repoPath, sha, grafts).catch(() => false))
        if (!provable) related = null
      }
      // A launch that has moved on takes no late answers: the map it was handed must not change.
      if (budget.stopped) return
      log(
        `[core-beta] ancestry ${sha.slice(0, 12)}: ${
          related === null
            ? 'unresolved (not provable on this checkout, so entries that need it do not match)'
            : related
              ? 'contained'
              : 'not contained'
        }`
      )
      if (related !== null) {
        ancestry.set(sha, related)
        provenRelations.set(relationKey(repoPath, head, sha), related)
      }
    }
  })()

  // The budget and a cancelled launch interrupt a git call in progress, not only the gap between
  // two: each call carries its own timeout, which alone could hold the launch past the budget.
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<'interrupted'>((resolve) => {
    timer = setTimeout(() => resolve('interrupted'), Math.max(0, deadline - Date.now()))
    onAbort = () => resolve('interrupted')
    signal?.addEventListener('abort', onAbort, { once: true })
    // The work above starts synchronously, so it may already have aborted before this listener.
    if (signal?.aborted) onAbort()
  })
  // Abandoned when interrupted, so it must never be left with an unhandled rejection.
  void work.catch((err: unknown) => warn('[core-beta] ancestry resolution failed:', err))
  try {
    // Cannot reject: a failure inside `work` is logged above and leaves the map partial, which is
    // the fail-closed answer. A beta lookup must never fail the launch.
    const outcome = await Promise.race([
      work.then(
        () => 'done' as const,
        () => 'done' as const
      ),
      interrupted
    ])
    if (outcome === 'interrupted') {
      log('[core-beta] ancestry: stopped early; SHAs not reached stay unresolved')
      options.onIncomplete?.()
    } else if (cutShort) {
      options.onIncomplete?.()
    }
  } finally {
    budget.stopped = true
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
  // Whatever this resolution could not prove, it also withholds, so a relation proven earlier must
  // not keep answering for it: a later display-only lookup is never more optimistic than the last
  // resolution, whatever made that one fall short (budget, abort, a failed git call).
  for (const [index, raw] of shas.entries()) {
    const sha = raw.toLowerCase()
    if (!FULL_SHA_RE.test(sha) || index >= MAX_RESOLVED_SHAS) continue
    if (!ancestry.has(sha)) provenRelations.delete(relationKey(repoPath, head, sha))
  }
  return { head, ancestry }
}
