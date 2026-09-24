import fs from 'fs'
import path from 'path'
import { fetchCommitSha, findMergeBase, resolveGitDir } from './git'
import { NO_CORE_COMMITS } from './coreBetaGrants'
import type { CoreCommitState } from './coreBetaGrants'
import type { CoreCheckout } from './version'

const FULL_SHA_RE = /^[0-9a-f]{40}$/

const MAX_RESOLVED_SHAS = 16

// Bounds launch delay: each fetch can run to its full timeout, and a failed one repeats every launch.
const MAX_FETCHES = 2

type Relation = boolean | null

// Not `isAncestorOf`: it answers `false` for "could not look", which would fail an upper bound open.
async function commitAncestry(
  repoPath: string,
  sha: string,
  head: string,
  mayFetch: () => boolean
): Promise<{ related: Relation; fetched: boolean }> {
  const relate = async (): Promise<Relation> => {
    const base = await findMergeBase(repoPath, sha, head)
    return base === undefined ? null : base.toLowerCase() === sha
  }
  const first = await relate()
  if (first !== null || !mayFetch()) return { related: first, fetched: false }
  if (!(await fetchCommitSha(repoPath, sha))) return { related: null, fetched: true }
  return { related: await relate(), fetched: true }
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

/** Sequential on purpose: concurrent fetches into one repository contend for its locks. */
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
        const result = await commitAncestry(repoPath, sha, head, () => fetches < MAX_FETCHES)
        if (result.fetched) fetches += 1
        related = result.related
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
