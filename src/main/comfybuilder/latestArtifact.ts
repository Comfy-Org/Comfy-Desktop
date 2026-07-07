/**
 * Latest-succeeded-artifact resolver for the ComfyBuilder pipeline source.
 *
 * Desktop's ComfyBuilder integration uses a "show all, block at install" UX:
 * every pipeline is always listed, and installability is computed as metadata
 * rather than by hiding entries. These helpers implement that computation and
 * never filter pipelines themselves.
 *
 * {@link resolveLatestArtifact} selects the newest succeeded deployment and,
 * within it, the per-target artifact matching the host platform. A ComfyBuilder
 * deployment fans out across a matrix (linux/windows × cpu/nvidia); each target
 * ships its own platform-specific archive, so a Windows host MUST install the
 * windows artifact — not the deployment-level `artifact`, which is only whichever
 * target happened to build first. {@link pipelineInstallState} turns the
 * selection into an install decision.
 */
import type { Artifact, Deployment, TargetBuildStatus } from './dto'

/**
 * A succeeded deployment paired with the artifact chosen for the host platform,
 * plus the matrix target it came from. `targetId` is the empty string only for a
 * legacy deployment served through the deployment-level `artifact` (a build from
 * before targets carried their own artifacts); a per-target selection always
 * carries the concrete target id the download must be scoped to.
 */
export interface ResolvedArtifact {
  deployment: Deployment
  artifact: Artifact
  targetId: string
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

/** True when a matrix target id's tokens include one of the host platform's (aliased) tokens. */
function targetMatchesPlatform(targetId: string, platform: string): boolean {
  const targetTokens = new Set(tokenize(targetId))
  return expandPlatformTokens(platform).some((token) => targetTokens.has(token))
}

/** A succeeded target status whose per-target artifact is guaranteed present. */
type TargetWithArtifact = TargetBuildStatus & { artifact: Artifact }

function targetHasArtifact(status: TargetBuildStatus): status is TargetWithArtifact {
  return status.status === 'succeeded' && status.artifact != null
}

/**
 * From a deployment's per-target statuses, pick the artifact matching `platform`.
 * Among OS-matching succeeded targets a `cpu` build is preferred over `nvidia`:
 * a CPU archive runs on any machine, whereas a GPU archive assumes CUDA, so CPU
 * is the safe default until the installer detects the host GPU. Returns `null`
 * when the deployment carries no per-target artifacts (legacy build) or none
 * match the host.
 */
function selectTargetArtifact(
  deployment: Deployment,
  platform: string
): { artifact: Artifact; targetId: string } | null {
  const statuses = deployment.target_statuses
  if (!Array.isArray(statuses)) return null
  const matches = statuses
    .filter(targetHasArtifact)
    .filter((status) => targetMatchesPlatform(status.target_id, platform))
  const [firstMatch] = matches
  if (firstMatch === undefined) return null
  const chosen =
    matches.find((status) => tokenize(status.target_id).includes('cpu')) ?? firstMatch
  return { artifact: chosen.artifact, targetId: chosen.target_id }
}

/**
 * True when a deployment fans out into per-target statuses that carry their own
 * artifacts — i.e. the backend is new enough to expose per-platform artifacts.
 * A legacy deployment (no such statuses) falls back to its single `artifact`.
 */
function hasPerTargetArtifacts(deployment: Deployment): boolean {
  const statuses = deployment.target_statuses
  return Array.isArray(statuses) && statuses.some(targetHasArtifact)
}

/**
 * Pick the newest succeeded deployment and the artifact to install from it.
 *
 * When `platform` is given and the deployment exposes per-target artifacts, the
 * artifact whose target matches the host OS is chosen and `targetId` is set so
 * the download is scoped to that target. When the deployment predates per-target
 * artifacts, the legacy deployment-level `artifact` is returned with an empty
 * `targetId`. Returns `null` when no deployment has any downloadable artifact,
 * or when per-target artifacts exist but none match the host platform (a
 * wrong-platform install is refused rather than served the wrong archive).
 */
export function resolveLatestArtifact(
  deployments: Deployment[],
  platform?: string
): ResolvedArtifact | null {
  const candidates = deployments.filter(hasDownloadableArtifact)
  if (candidates.length === 0) return null
  const [best] = [...candidates].sort(byFinishedThenId)
  if (!best) return null

  if (typeof platform === 'string' && platform.length > 0 && hasPerTargetArtifacts(best)) {
    const selected = selectTargetArtifact(best, platform)
    if (selected === null) return null
    return { deployment: best, artifact: selected.artifact, targetId: selected.targetId }
  }
  return { deployment: best, artifact: best.artifact, targetId: '' }
}

/**
 * Compute whether a pipeline can be installed from its deployments.
 *
 * - No succeeded deployment with an artifact -> not installable
 *   (`no-successful-build`).
 * - The latest deployment exposes per-target artifacts but none match the host
 *   `platform` -> not installable (`platform-mismatch`).
 * - Otherwise installable. A legacy deployment with no per-target artifacts is
 *   installable regardless of platform and defers to install-time manifest
 *   validation.
 */
export function pipelineInstallState(
  deployments: Deployment[],
  platform?: string
): PipelineInstallState {
  if (resolveLatestArtifact(deployments) === null) {
    return { installable: false, reason: 'no-successful-build' }
  }
  if (resolveLatestArtifact(deployments, platform) === null) {
    return { installable: false, reason: 'platform-mismatch' }
  }
  return { installable: true }
}
