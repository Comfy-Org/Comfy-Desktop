/**
 * Target resolution — pure host <-> artifact matching.
 *
 * A version fans out into per-target artifacts (os x gpu x accel). The UI picks
 * ONE distribution + version; this module picks the artifact for the host, so a
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
 * Pick the best `ready` artifact for the host: the one whose OS matches and
 * whose GPU best fits (exact, else CPU fallback). Returns null when the version
 * has no runnable artifact for this machine (e.g. a windows-only build on mac).
 */
export function selectArtifactForHost(artifacts: readonly Artifact[], host: Host): Artifact | null {
  let best: Artifact | null = null
  let bestScore = 0
  for (const a of artifacts) {
    if (a.status !== 'ready' || a.os !== host.os) continue
    const score = gpuScore(a.gpu, host.gpu)
    if (score > bestScore) {
      best = a
      bestScore = score
    }
  }
  return best
}
