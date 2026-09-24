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

// A truncated graph can give a merge-base other than `sha` even when HEAD contains it: trust only `true`.
function isShallow(repoPath: string): boolean {
  const gitDir = resolveGitDir(repoPath)
  if (gitDir === null) return true
  try {
    return fs.existsSync(path.join(gitDir, 'shallow'))
  } catch {
    return true
  }
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
  const shallow = isShallow(repoPath)
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
      if (related === false && shallow) related = null
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
