/**
 * Target resolution - pure host <-> artifact matching.
 *
 * A version fans out into per-target artifacts (os x gpu x accel). This module
 * identifies and ranks every artifact the host can run. Pure functions, no I/O;
 * the caller supplies the host GPU (Desktop already detects it).
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
 * Every ready artifact this host can run, best match first. Exact GPU matches
 * precede the CPU fallback, then accelerator preference and stable target IDs
 * make the order deterministic.
 */
export function compatibleArtifactsForHost(artifacts: readonly Artifact[], host: Host): Artifact[] {
  return artifacts
    .filter((artifact) => artifact.status === 'ready' && artifact.os === host.os)
    .filter((artifact) => score(artifact, host) > 0)
    .sort((a, b) => {
      const scoreDifference = score(b, host) - score(a, host)
      if (scoreDifference !== 0) return scoreDifference
      const variantDifference = b.accelVariant.localeCompare(a.accelVariant)
      if (variantDifference !== 0) return variantDifference
      return a.id.localeCompare(b.id)
    })
}

/**
 * Pick the best `ready` artifact for the host: OS must match, then GPU fit
 * (exact, else CPU fallback), then a preferred `accelVariant`, then a
 * deterministic tie-break. Returns null when the version has no runnable
 * artifact for this machine (e.g. a windows-only build on mac).
 */
export function selectArtifactForHost(artifacts: readonly Artifact[], host: Host): Artifact | null {
  return compatibleArtifactsForHost(artifacts, host)[0] ?? null
}
