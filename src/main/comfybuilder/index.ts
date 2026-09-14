/**
 * ComfyBuilder functionality library - public surface.
 *
 * A standalone, UI-agnostic library for the Desktop <-> comfy-builder flow:
 * list builds/versions/artifacts, pick the artifact for the host,
 * download + install it, build its launch command, and create Platform drafts
 * from Desktop snapshots. It has NO dependency on Electron IPC, Vue, or the
 * installations store; the UI plugs in by supplying a {@link TokenProvider}.
 *
 * Typical UI wiring:
 * ```ts
 * const client = new ComfyBuilderClient({ baseUrl, auth: tokenStoreAdapter })
 * const builds = await client.listBuilds()                     // render tiles
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
export type { StageModelsOptions, StageModelsErrorKind, ModelJobSurface } from './models'
export { resolveModelManifest } from './modelManifest'
export { buildLaunchSpec, venvPython } from './launch'
export type { LaunchOptions } from './launch'
export type {
  Artifact,
  ArtifactGpu,
  ArtifactOs,
  Build,
  BuildDraft,
  BuildVersion,
  Host,
  InstallProgress,
  LaunchSpec,
  ModelDescriptor,
  ModelManifest,
  ModelPolicy,
  StageProgress,
  TokenProvider
} from './types'
