/**
 * Target resolution - pure host <-> artifact matching.
 *
 * A version fans out into per-target artifacts (os x gpu x accel). The UI picks
 * ONE build + version; this module picks the artifact for the host, so a
 * user never chooses `windows/cpu` vs `windows/nvidia` by hand. Pure functions,
 * no I/O; the caller supplies the host GPU (Desktop already detects it).
 */
import type { Artifact, ArtifactGpu, ArtifactOs, Host } from './types'

/** The host OS as a build-target token, from Node's `process.platform`. */
export function hostOs(): ArtifactOs {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'mac'
    default:
      return 'linux'
  }
}

/**
 * Rank an artifact's GPU against the host's, higher is better. An exact match
 * wins; a CPU artifact is the universal fallback (every host can run it); an
 * NVIDIA host tolerates a CPU build but never the reverse.
 */
function gpuScore(artifactGpu: ArtifactGpu, hostGpu: ArtifactGpu): number {
  if (artifactGpu === hostGpu) return 2
  if (artifactGpu === 'cpu') return 1
  return -1
}

/**
 * Score an artifact for the host: GPU fit is dominant; a matching `accelVariant`
 * (e.g. cu128) breaks ties among same-GPU builds, then `accelVariant` string
 * order makes the choice deterministic (never input-order dependent).
 */
function score(a: Artifact, host: Host): number {
  const gpu = gpuScore(a.gpu, host.gpu)
  if (gpu < 0) return gpu
  const accelMatch = host.accelVariant && a.accelVariant === host.accelVariant ? 1 : 0
  return gpu * 2 + accelMatch
}

/**
 * Pick the best `ready` artifact for the host: OS must match, then GPU fit
 * (exact, else CPU fallback), then a preferred `accelVariant`, then a
 * deterministic tie-break. Returns null when the version has no runnable
 * artifact for this machine (e.g. a windows-only build on mac).
 */
export function selectArtifactForHost(artifacts: readonly Artifact[], host: Host): Artifact | null {
  let best: Artifact | null = null
  let bestScore = 0
  for (const a of artifacts) {
    if (a.status !== 'ready' || a.os !== host.os) continue
    const s = score(a, host)
    if (s <= 0) continue
    // Strictly greater wins; on an exact tie, the lexicographically larger
    // accelVariant wins (the newer accelerator build, e.g. cu128 over cu118)
    // so selection is deterministic across input orderings and never
    // regresses to an older build.
    if (s > bestScore || (s === bestScore && best !== null && a.accelVariant > best.accelVariant)) {
      best = a
      bestScore = s
    }
  }
  return best
}
