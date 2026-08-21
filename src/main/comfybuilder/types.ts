/**
 * ComfyBuilder functionality library - domain types.
 *
 * The wire shapes this library reads from the comfy-builder API (mirrors the
 * relevant halves of its `openapi.yaml`), plus the small seams the UI plugs into
 * (a {@link TokenProvider} for auth, progress callbacks for install). Nothing
 * here depends on Electron, IPC, Vue, or the installations store.
 */

export type ArtifactOs = 'linux' | 'windows' | 'mac'
export type ArtifactGpu = 'nvidia' | 'amd' | 'cpu' | 'mps'

/** A product Build returned by Builder. */
export interface Build {
  id: string
  name: string
  description?: string
  numCustomNodes?: number
  numModels?: number
  updatedAt?: string
}

/** Builder draft created from a Desktop snapshot. */
export interface BuildDraft {
  buildId: string
  workspaceId: string
  editUrl: string
}

/** One immutable version of a product Build, fanned out into target artifacts. */
export interface BuildVersion {
  id: string
  /** Monotonic version number within the product Build. */
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
  /** Storage ref of the built archive (the API's `archiveRef`). Absent until the target is ready. */
  archiveRef?: string
  /** Hex sha256 of the archive (the API's `archiveSha256`, optionally `sha256:`-prefixed).
   *  Installation requires and verifies this value. */
  archiveSha256?: string
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
  /** Optional: called when the API rejects the token so the UI can re-auth. The
   *  rejected token lets the owner avoid signing out a newer concurrent login. */
  onUnauthorized?(rejectedAccessToken: string): void
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

/**
 * One model the product Build pre-installs, projected from the version's sealed
 * manifest by the Builder API. `type`
 * is the ComfyUI model directory the file installs into (e.g. `checkpoints`),
 * so the file lands at `models/<type>/<filename>`. `downloadUrl` is ready to GET
 * as-is (a public source URL, or a short-lived presigned URL for a private one).
 */
export interface ModelDescriptor {
  type: string
  filename: string
  /** Hex sha256 of the content. Model installation requires and verifies it. */
  sha256: string
  downloadUrl: string
  /** When `downloadUrl` expires (presigned URLs only). Advisory. */
  expiresAt?: string
}

/** A runtime allow/deny list. Advisory metadata the client may later enforce;
 *  staging does not gate on it. */
export interface ModelPolicy {
  mode: 'allowlist' | 'blocklist'
  list?: string[]
}

/**
 * The model + policy view of a Build version. A client stages `models` before
 * starting ComfyUI; the archive itself carries only code and the environment,
 * never weights.
 */
export interface ModelManifest {
  models: ModelDescriptor[]
  modelPolicy?: ModelPolicy | null
  partnerNodePolicy?: ModelPolicy | null
}

/** Per-model staging progress, surfaced to the UI while models download. */
export interface StageProgress {
  /** 1-based index of the model currently downloading. */
  index: number
  total: number
  filename: string
  /** Percent of the current model (0-100). */
  percent: number
  /** Bytes received for the current model; absent until the transfer reports. */
  receivedBytes?: number
  /** Total bytes of the current model; absent when the server sends no size. */
  totalBytes?: number
  /** Transfer rate over the last sample window; absent on the first sample. */
  speedBytesPerSec?: number
  /** Seconds until the current model completes at the sampled rate. */
  etaSecs?: number
}
