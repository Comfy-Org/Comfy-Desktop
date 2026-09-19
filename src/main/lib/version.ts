import semver from 'semver'
import type { InstallationRecord } from '../installations'

/** Ground-truth version data for an installed ComfyUI, stored on the
 *  installation record as `comfyVersion`. */
export interface ComfyVersion {
  /** Full 40-character commit SHA. */
  commit: string
  /** Nearest stable release tag (e.g. "v0.14.2"). */
  baseTag?: string
  /** Commits ahead of baseTag (0 = on the tag, >0 = latest channel). */
  commitsAhead?: number
  /**
   * Whether `baseTag` was established by ANCESTRY — the tag is reachable from `commit`, so the
   * install provably contains that release. False when it came from a fallback that labels the
   * install with a release it may not contain: `resolveLocalVersion`'s merge-base branch runs
   * only because the tag is NOT an ancestor, and a caller-supplied `fallbackTag` is not derived
   * from the graph at all. Absent on records written before this field existed.
   *
   * Display tolerates an unverified label (a reasonable name beats a bare SHA); a version GATE
   * must not — see {@link coreSemverVerified}.
   */
  baseTagVerified?: boolean
}

/**
 * Format a {@link ComfyVersion} for display.
 *
 * @param v  Structured version data (may be undefined for legacy installs).
 * @param style  `'short'` for cards (`v0.14.2+21`), `'detail'` for the
 *               Manage view (`v0.14.2 + 21 commits (a1b2c3d)`).
 */
export function formatComfyVersion(v: ComfyVersion | undefined, style: 'short' | 'detail'): string {
  if (!v) return 'unknown'

  const { commit, baseTag, commitsAhead } = v
  const shortSha = commit.slice(0, 7)

  if (!baseTag) return shortSha

  // Exactly on the tag — display as the tag alone.
  if (commitsAhead === 0) return baseTag

  // undefined = GitHub comparison API failed: show tag + SHA to signal
  // uncertainty rather than implying we're exactly on the stable tag.
  if (commitsAhead === undefined) {
    return `${baseTag} (${shortSha})`
  }

  if (style === 'short') {
    return `${baseTag}+${commitsAhead}`
  }

  return `${baseTag} + ${commitsAhead} commit${commitsAhead !== 1 ? 's' : ''} (${shortSha})`
}

/**
 * The install's core release as a strict semver string, or `null` when it
 * cannot be established — the input to version-gated feature decisions.
 *
 * Validation is deliberately whole-token (`semver.valid`, never
 * `semver.coerce`) and fail-closed. Coercion would break the gate two ways:
 * a git install stores only the first 8 commit chars in `version`
 * (`src/main/sources/git.ts`), so a numeric-leading SHA like `61e5e3b5` would
 * coerce to `61.0.0` and satisfy any minimum; and `0.3.80-rc.1` would coerce
 * to stable `0.3.80`, enrolling prereleases that a `>=0.3.80` range must
 * exclude. Keeping prereleases intact lets semver order them correctly.
 */
export function coreSemver(inst: InstallationRecord): string | null {
  const raw = inst.comfyVersion?.baseTag ?? inst.version
  if (typeof raw !== 'string') return null
  return semver.valid(raw.replace(/^v/, ''))
}

/**
 * Whether the install sits EXACTLY on its release tag, so {@link coreSemver}
 * names the code that is actually running rather than a floor.
 *
 * `commitsAhead` is `undefined` when the GitHub comparison failed: the distance
 * past the tag is unknown, not zero, so that reads as inexact — the same
 * refusal {@link formatComfyVersion} makes when it declines to print a bare
 * tag. An upper version bound is only meaningful against an exact match: on a
 * latest-channel install `baseTag` lags the real code, so code far past the
 * bound still measures as inside it.
 */
export function coreSemverExact(inst: InstallationRecord): boolean {
  return inst.comfyVersion?.commitsAhead === 0
}

/**
 * Whether {@link coreSemver} names a release the install PROVABLY contains, rather than one
 * `resolveLocalVersion` pinned on it by a fallback. Only an ancestry-established `baseTag`
 * qualifies; see {@link ComfyVersion.baseTagVerified}.
 *
 * Fail-closed on absence, which covers three cases that must all read the same way: a record
 * persisted before this field existed, a `comfyVersion` reconstructed by hand (snapshot
 * restore replays a stored tag it cannot re-derive), and the `inst.version` path `coreSemver`
 * falls back to, where there is no resolved tag to have verified in the first place. Each is
 * a tag of unknown provenance, so `=== true` is the only reading that grants.
 */
export function coreSemverVerified(inst: InstallationRecord): boolean {
  return inst.comfyVersion?.baseTagVerified === true
}

/**
 * What the launching install's git checkout could be established to be. Three states, because
 * `readGitHead`'s `string | null` conflates two very different absences: it returns `null` both
 * for an install that has no git directory at all and for one that has a git directory whose
 * HEAD it could not read (empty HEAD, ref escaping the git dir, missing ref with no packed-refs
 * entry, or an IO/permission error). Only the first means nothing can contradict the record.
 *
 * Resolved by the caller — {@link coreRecordCurrent} stays free of filesystem access.
 */
export type CoreCheckout =
  | { kind: 'not-git' }
  | { kind: 'head'; commit: string }
  | { kind: 'unreadable' }

/**
 * Whether the record still describes the checkout being launched.
 *
 * The other gate readers all answer questions about the RECORDED commit — {@link coreSemverExact}
 * asks whether that commit sat on its tag, {@link coreSemverVerified} whether ancestry
 * established the tag. Neither asks whether the install is still AT that commit, so a `git pull`
 * after the record was written leaves both of them true of code that is no longer running. This
 * closes that gap, and only that gap: it is a staleness check, not a version claim.
 *
 * Fail-closed on every state except the one where there is provably nothing to disagree with.
 * `not-git` is the ordinary standalone/archive install — no second opinion exists, so the record
 * stands and those installs keep their grants. `unreadable` is NOT that: the install is git-
 * managed and we failed to inspect it, which is likeliest during the `git pull` this gate exists
 * to catch, so it refuses. With a readable `head` the checkout is authoritative, and a record
 * with no comparable commit cannot be confirmed against it.
 *
 * Compared case-insensitively (hex SHAs name the same commit in either case) but whole-token: the
 * field is a full 40-character SHA, and prefix-matching an abbreviated one would accept a record
 * that merely starts the same way.
 */
export function coreRecordCurrent(inst: InstallationRecord, checkout: CoreCheckout): boolean {
  switch (checkout.kind) {
    case 'not-git':
      return true
    case 'unreadable':
      return false
    case 'head': {
      const recorded = inst.comfyVersion?.commit
      if (typeof recorded !== 'string') return false
      return recorded.toLowerCase() === checkout.commit.toLowerCase()
    }
  }
}

/**
 * Compare two tag-ish strings tolerant of a leading `v`. The comfyui_version.py
 * `__version__` string is bare ("0.24.0") while GitHub tag names are
 * "v"-prefixed ("v0.24.0"); legacy code paths persist either form. Without
 * this normalization an adopted install permanently looks one revision
 * behind because "0.24.0" !== "v0.24.0".
 */
export function tagsEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return a.replace(/^v/, '') === b.replace(/^v/, '')
}
