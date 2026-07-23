/**
 * ComfyBuilder functionality library — domain types.
 *
 * The wire shapes this library reads from the comfy-builder API (mirrors the
 * relevant halves of its `openapi.yaml`), plus the small seams the UI plugs into
 * (a {@link TokenProvider} for auth, progress callbacks for install). Nothing
 * here depends on Electron, IPC, Vue, or the installations store.
 */

export type ArtifactOs = 'linux' | 'windows' | 'mac'
export type ArtifactGpu = 'nvidia' | 'amd' | 'cpu' | 'mps'

/** A distribution: a named, versioned ComfyUI environment recipe. */
export interface Distribution {
  id: string
  name: string
  description?: string
  numCustomNodes?: number
  numModels?: number
  updatedAt?: string
}

/** One immutable build of a distribution (fans out into per-target artifacts). */
export interface DistributionVersion {
  id: string
  /** Monotonic version number within the distribution. */
  version: number
  status: string
  createdAt?: string
}

/** A single built target: one os x gpu x accel archive of a version. */
export interface Artifact {
  id: string
  os: ArtifactOs
  gpu: ArtifactGpu
  /** Accelerator build variant, e.g. `cu128`. Part of the target identity. */
  accelVariant: string
  status: string
  /** Storage ref of the built archive. */
  outputRef?: string
  /** Hex sha256 of the archive (optionally `sha256:`-prefixed). Verified post-download. */
  outputSha256?: string
}

/** The machine an install targets: which artifact to pick. */
export interface Host {
  os: ArtifactOs
  gpu: ArtifactGpu
  /** Preferred accelerator build (e.g. `cu128`) when a gpu ships several. Optional. */
  accelVariant?: string
}

/**
 * The auth seam. The UI owns sign-in and token storage; this library only reads
 * a bearer token when it needs one. Willie's `tokenStore` implements this.
 */
export interface TokenProvider {
  /** Current access token, or null when signed out. */
  getAccessToken(): Promise<string | null>
  /** Optional: called when the API rejects the token so the UI can re-auth. */
  onUnauthorized?(): void
}

/** A launch command spec (interpreter + args + cwd), free of Electron types. */
export interface LaunchSpec {
  cmd: string
  args: string[]
  cwd: string
  port: number
}

/** Install progress, surfaced to the UI's progress bar. */
export interface InstallProgress {
  phase: 'resolve' | 'download' | 'extract'
  percent: number
  detail?: string
}
