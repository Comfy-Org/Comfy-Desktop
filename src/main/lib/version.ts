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
