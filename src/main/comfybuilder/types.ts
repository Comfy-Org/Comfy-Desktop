/**
 * ComfyBuilder OpenAPI shapes the Desktop install path consumes.
 * Mirrors the `Artifact` + `SignedDownload` schemas in comfy-builder's
 * `openapi.yaml` (kept intentionally to just the fields Desktop reads).
 */

export type ArtifactOs = 'linux' | 'windows' | 'mac'
export type ArtifactGpu = 'nvidia' | 'amd' | 'cpu' | 'mps'

/** A single built target for a distribution version. */
export interface Artifact {
  id: string
  os: ArtifactOs
  gpu: ArtifactGpu
  /** Accelerator build variant, e.g. `cu128`. Part of the target identity. */
  accelVariant: string
  /** Storage ref of the built archive. */
  outputRef?: string
  /** Hex sha256 of the archive, optionally `sha256:`-prefixed. Verified post-download. */
  outputSha256?: string
  status: string
}

/** Short-lived presigned GET link to an artifact's archive in storage. */
export interface SignedDownload {
  downloadUrl: string
  expiresAt: string
}
