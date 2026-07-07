/**
 * Latest-succeeded-artifact resolver for the ComfyBuilder pipeline source.
 *
 * Desktop's ComfyBuilder integration uses a "show all, block at install" UX:
 * every pipeline is always listed, and installability is computed as metadata
 * rather than by hiding entries. These helpers implement that computation and
 * never filter pipelines themselves.
 *
 * {@link resolveLatestArtifact} selects the newest succeeded deployment that
 * actually carries a downloadable artifact. {@link pipelineInstallState} turns
 * that selection into an install decision, with a best-effort platform check.
 */
import type { Artifact, Deployment } from './dto'

/** A succeeded deployment paired with its downloadable artifact. */
export interface ResolvedArtifact {
  deployment: Deployment
  artifact: Artifact
}

/** Why a pipeline cannot be installed right now. */
export type PipelineInstallReason = 'no-successful-build' | 'platform-mismatch'

/** Install decision for a pipeline; `reason` is present only when blocked. */
export interface PipelineInstallState {
  installable: boolean
  reason?: PipelineInstallReason
}

/** A succeeded deployment whose artifact is guaranteed present. */
type DeploymentWithArtifact = Deployment & { artifact: Artifact }

/**
 * True when the deployment has an artifact to download. A `partial` deployment
 * (some matrix targets failed, others succeeded) still serves the artifact a
 * succeeded target produced, so it is downloadable just like a fully `succeeded`
 * one.
 */
function hasDownloadableArtifact(deployment: Deployment): deployment is DeploymentWithArtifact {
  return (deployment.status === 'succeeded' || deployment.status === 'partial') && deployment.artifact != null
}

/**
 * Parse `finished_at` into a comparable epoch value. Missing, null, empty, or
 * malformed timestamps return `null` so callers can sort them last (oldest).
 */
function finishedAtValue(deployment: Deployment): number | null {
  const value = deployment.finished_at
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Order deployments newest-first by `finished_at`, pushing entries with a
 * missing/invalid `finished_at` to the end, and tie-breaking by `id` descending
 * so the result is fully deterministic regardless of input order.
 */
function byFinishedThenId(a: Deployment, b: Deployment): number {
  const aValue = finishedAtValue(a)
  const bValue = finishedAtValue(b)
  if (aValue !== bValue) {
    if (aValue === null) return 1
    if (bValue === null) return -1
    return bValue - aValue
  }
  if (a.id === b.id) return 0
  return a.id < b.id ? 1 : -1
}

/**
 * Pick the newest succeeded deployment that has an artifact, or `null` when no
 * deployment qualifies.
 */
export function resolveLatestArtifact(deployments: Deployment[]): ResolvedArtifact | null {
  const candidates = deployments.filter(hasDownloadableArtifact)
  if (candidates.length === 0) return null
  const [best] = [...candidates].sort(byFinishedThenId)
  if (!best) return null
  return { deployment: best, artifact: best.artifact }
}

/**
 * Collect best-effort platform identifiers for a deployment. ComfyBuilder does
 * not yet stamp explicit platform metadata onto Deployment/Artifact objects, so
 * these fields are read defensively through the Deployment index signature; when
 * none are present the caller treats the build as installable and defers to
 * install-time manifest validation.
 */
function collectPlatformHints(deployment: Deployment): string[] {
  const hints: string[] = []
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) hints.push(value)
  }
  add(deployment.platform)
  add(deployment.target_id)
  add(deployment.target)
  const targetStatuses = deployment.target_statuses
  if (Array.isArray(targetStatuses)) {
    for (const entry of targetStatuses) {
      if (entry !== null && typeof entry === 'object') {
        add((entry as Record<string, unknown>).target_id)
      }
    }
  }
  return hints
}

/** Split a platform identifier into lowercase alphanumeric tokens. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

/**
 * Map a Node `process.platform` token to the OS token ComfyBuilder stamps onto
 * artifact target ids. Node reports `win32`/`darwin`; build targets are named
 * `windows-*`/`macos-*`, so a raw token match never overlaps. `linux` is already
 * shared by both sides and needs no mapping.
 */
const NODE_PLATFORM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  win32: ['windows'],
  darwin: ['macos', 'darwin', 'osx'],
}

/**
 * Expand a caller-supplied platform string into its tokens plus any
 * ComfyBuilder OS aliases, so a Node `process.platform` value matches the
 * `windows`/`macos` tokens used in build target ids.
 */
function expandPlatformTokens(value: string): string[] {
  const tokens = tokenize(value)
  const expanded = new Set(tokens)
  for (const token of tokens) {
    for (const alias of NODE_PLATFORM_ALIASES[token] ?? []) {
      expanded.add(alias)
    }
  }
  return [...expanded]
}

/** True when two platform identifiers share at least one token, applying Node platform aliases. */
function platformsOverlap(a: string, b: string): boolean {
  const tokens = new Set(tokenize(a))
  return expandPlatformTokens(b).some((token) => tokens.has(token))
}

/**
 * Compute whether a pipeline can be installed from its deployments.
 *
 * - No succeeded deployment with an artifact -> not installable
 *   (`no-successful-build`).
 * - A `platform` is supplied AND the latest deployment carries platform
 *   metadata that shares no token with it -> not installable
 *   (`platform-mismatch`). Best-effort only: absent metadata never blocks.
 * - Otherwise installable.
 */
export function pipelineInstallState(
  deployments: Deployment[],
  platform?: string
): PipelineInstallState {
  const resolved = resolveLatestArtifact(deployments)
  if (resolved === null) {
    return { installable: false, reason: 'no-successful-build' }
  }
  if (typeof platform === 'string' && platform.length > 0) {
    const hints = collectPlatformHints(resolved.deployment)
    if (hints.length > 0 && !hints.some((hint) => platformsOverlap(hint, platform))) {
      return { installable: false, reason: 'platform-mismatch' }
    }
  }
  return { installable: true }
}
