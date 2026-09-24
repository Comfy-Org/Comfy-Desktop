/**
 * Relates the commit-bound Core beta grants to the launching checkout. The launch path resolves
 * these facts and hands them to `selectCoreBetaGrantArgs`, which stays pure: ancestry needs the
 * repository, and possibly the network.
 */
import fs from 'fs'
import path from 'path'
import { fetchCommitSha, findMergeBase, resolveGitDir } from './git'
import { NO_CORE_COMMITS } from './coreBetaGrants'
import type { CoreCommitState } from './coreBetaGrants'
import type { CoreCheckout } from './version'

const FULL_SHA_RE = /^[0-9a-f]{40}$/

/** How `sha` relates to `head`: `true` when `head` contains it, `false` when it provably does
 *  not, `null` when neither could be established.
 *
 *  Built on merge-base rather than `isAncestorOf`, which answers `false` for "not an ancestor"
 *  and for "could not look" alike. That conflation is harmless for a lower bound but fails an
 *  upper bound OPEN — a SHA missing from the object store would read as "not yet reached". A
 *  merge-base that exists and is not `sha` is a real answer; no merge-base at all is not.
 *
 *  A SHA the checkout lacks is fetched once, while the launch's fetch budget lasts, and asked again. That is what turns "absent" into an
 *  answer: on a full clone an upper bound HEAD has not reached yet is usually not local at all.
 *  When the fetch fails too (offline, a remote bundled pygit2 cannot reach over its HTTPS-only
 *  transport, no git at all) the result stays `null`, and both bounds treat `null` as no match. */
/** Distinct SHAs one launch will relate. Payload shape alone allows hundreds; the rest stay
 *  unresolved, which fails their entries closed. */
const MAX_RESOLVED_SHAS = 16

/** Fetches one launch may attempt. Each can take the fetch timeout in full when the network
 *  blackholes, and a SHA that failed to fetch fails again on the next launch, so this — not the
 *  SHA count — is what bounds the delay a payload can add to every launch. */
const MAX_FETCHES = 2

type Relation = boolean | null

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

/** A shallow clone's graph is truncated, so a merge-base computed over it can be some other
 *  commit even when HEAD really does contain `sha` — which would fail an upper bound OPEN. A
 *  `true` stays sound there (the path from HEAD to `sha` is local), so only `false` is dropped. */
function isShallow(repoPath: string): boolean {
  const gitDir = resolveGitDir(repoPath)
  if (gitDir === null) return true
  try {
    return fs.existsSync(path.join(gitDir, 'shallow'))
  } catch {
    return true
  }
}

/** Relate every SHA the payload's commit entries name to the live HEAD. Only a readable HEAD is
 *  measured: `not-git` has no history to ask and `unreadable` could not be inspected, so both
 *  resolve nothing and every commit entry fails closed. Version entries are unaffected — they
 *  are measured against the record, not this.
 *
 *  Sequential on purpose: two fetches into one repository at once contend for the same locks. */
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
        related === null ? 'unresolved' : related ? 'contained' : 'not contained'
      }`
    )
    if (related !== null) ancestry.set(sha, related)
  }
  return { head, ancestry }
}
