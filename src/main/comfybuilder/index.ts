/**
 * ComfyBuilder functionality library - public surface.
 *
 * A standalone, UI-agnostic library for the Desktop <-> comfy-builder flow:
 * list distributions/versions/artifacts, pick the artifact for the host,
 * download + install it, and build its launch command. It has NO dependency on
 * Electron IPC, Vue, or the installations store; the UI plugs in by supplying a
 * {@link TokenProvider} and calling these functions.
 *
 * Typical UI wiring:
 * ```ts
 * const client = new ComfyBuilderClient({ baseUrl, auth: tokenStoreAdapter })
 * const dists = await client.listDistributions()               // render tiles
 * const { artifacts } = await client.getVersion(versionId)
 * const artifact = selectArtifactForHost(artifacts, { os: hostOs(), gpu })
 * await installArtifact({ artifact, client, installPath, cacheDir, onProgress })
 * const launch = buildLaunchSpec(installPath, { launchArgs })
 * ```
 */
export { ComfyBuilderClient, ComfyBuilderApiError, DEFAULT_BASE_URL } from './client'
export type { ComfyBuilderClientOptions, ComfyBuilderErrorKind } from './client'
export { hostOs, selectArtifactForHost } from './targets'
export { installArtifact, ComfyBuilderInstallError, sha256File } from './install'
export type { InstallArtifactOptions, ComfyBuilderInstallErrorKind } from './install'
export { normalizeSha256 } from './integrity'
export { stageModels, installModelsRoot, StageModelsError } from './models'
export type { StageModelsOptions, StageModelsErrorKind } from './models'
export { resolveModelManifest } from './modelManifest'
export { buildLaunchSpec, venvPython } from './launch'
export type { LaunchOptions } from './launch'
export type {
  Artifact,
  ArtifactGpu,
  ArtifactOs,
  Distribution,
  DistributionVersion,
  Host,
  InstallProgress,
  LaunchSpec,
  ModelDescriptor,
  ModelManifest,
  ModelPolicy,
  StageProgress,
  TokenProvider
} from './types'
