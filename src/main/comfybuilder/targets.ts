import type { Artifact, ArtifactGpu, ArtifactOs, Host } from './types'

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

function gpuScore(artifactGpu: ArtifactGpu, hostGpu: ArtifactGpu): number {
  if (artifactGpu === hostGpu) return 2
  if (artifactGpu === 'cpu') return 1
  return -1
}

function score(a: Artifact, host: Host): number {
  const gpu = gpuScore(a.gpu, host.gpu)
  if (gpu < 0) return gpu
  const accelMatch = host.accelVariant && a.accelVariant === host.accelVariant ? 1 : 0
  return gpu * 2 + accelMatch
}

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

export function selectArtifactForHost(artifacts: readonly Artifact[], host: Host): Artifact | null {
  return compatibleArtifactsForHost(artifacts, host)[0] ?? null
}
