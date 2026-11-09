import { isTerminalRelease } from '../comfybuilder/releases'
import { compatibleArtifactsForHost, hostOs, selectArtifactForHost } from '../comfybuilder/targets'
import type { Artifact, Build, BuildVersion, Host } from '../comfybuilder/types'
import type { ComfyBuilderClient } from '../comfybuilder/client'
import { detectGPUCached } from '../lib/gpu'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { setCachedVersions } from './versionCache'

export type BuildRowState = 'installable' | 'no-build' | 'platform-mismatch' | 'update-available'

export interface BuildRow {
  id: string
  name: string
  description?: string
  createdBy?: string
  creatorName?: string
  version?: string
  comfyuiVersion?: string
  finishedAt?: string
  numModels?: number
  numAllowedModels?: number
  numCustomNodes?: number
  sizeBytes?: number
  updatedAt?: string
  state: BuildRowState
  installedVersion?: number
  blockedReason?: string
  targetOs?: string[]
  releaseTargets?: Array<{
    artifactId: string
    releaseVersion: number
    os: Artifact['os']
    gpu: Artifact['gpu']
    accelVariant: string
    recommended: boolean
  }>
}

export interface ResolvedHostArtifact {
  artifact: Artifact
  version: number
}

export async function resolveHost(): Promise<Host> {
  const gpu = await detectGPUCached()
  const mapped = gpu?.id === 'nvidia' || gpu?.id === 'amd' || gpu?.id === 'mps' ? gpu.id : 'cpu'
  return { os: hostOs(), gpu: mapped }
}

function latestTerminalVersion<T extends { version: number; status: string }>(
  versions: T[]
): T | null {
  const terminal = versions
    .filter((v) => isTerminalRelease(v.status))
    .sort((a, b) => b.version - a.version)
  return terminal[0] ?? null
}

async function buildRow(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  build: Build,
  installed?: ReadonlyMap<string, number>,
  cacheGeneration?: number
): Promise<BuildRow> {
  const base: BuildRow = {
    id: build.id,
    name: build.name,
    ...(build.description ? { description: build.description } : {}),
    ...(build.createdBy ? { createdBy: build.createdBy } : {}),
    ...(typeof build.numModels === 'number' ? { numModels: build.numModels } : {}),
    ...(typeof build.numAllowedModels === 'number'
      ? { numAllowedModels: build.numAllowedModels }
      : {}),
    ...(typeof build.numCustomNodes === 'number' ? { numCustomNodes: build.numCustomNodes } : {}),
    ...(typeof build.sizeBytes === 'number' ? { sizeBytes: build.sizeBytes } : {}),
    ...(build.updatedAt ? { updatedAt: build.updatedAt } : {}),
    state: 'no-build'
  }

  const allVersions = await client.listVersions(build.id)
  const latest = latestTerminalVersion(allVersions)
  if (!latest) {
    setCachedVersions(build.id, [], cacheGeneration)
    const pending = allVersions.some(
      (v) => v.status === 'queued' || v.status === 'building' || v.status === 'stopping'
    )
    return {
      ...base,
      state: 'no-build',
      blockedReason: pending ? 'buildInProgress' : 'buildFailed'
    }
  }

  const installedVersion = installed?.get(build.id)
  const withVersion: BuildRow = {
    ...base,
    version: String(latest.version),
    ...(latest.createdAt ? { finishedAt: latest.createdAt } : {}),
    ...(installedVersion !== undefined ? { installedVersion } : {})
  }

  const { artifacts } = await client.getVersion(latest.id)
  try {
    setCachedVersions(
      build.id,
      await updateVersions(allVersions, host, async (id) =>
        id === latest.id ? artifacts : (await client.getVersion(id)).artifacts
      ),
      cacheGeneration
    )
  } catch (err) {
    console.error('[devplatform] failed to warm version cache:', err)
  }
  const targetOs = [
    ...new Set(
      artifacts.filter((artifact) => artifact.status === 'ready').map((artifact) => artifact.os)
    )
  ].sort()
  if (targetOs.length) withVersion.targetOs = targetOs
  const compatibleArtifacts = compatibleArtifactsForHost(artifacts, host)
  const artifact = compatibleArtifacts[0]
  if (!artifact) {
    return {
      ...withVersion,
      state: 'platform-mismatch',
      blockedReason: 'noArtifactForMachine'
    }
  }
  withVersion.releaseTargets = compatibleArtifacts.map((target, index) => ({
    artifactId: target.id,
    releaseVersion: latest.version,
    os: target.os,
    gpu: target.gpu,
    accelVariant: target.accelVariant,
    recommended: index === 0
  }))
  if (installedVersion !== undefined && latest.version > installedVersion) {
    return { ...withVersion, state: 'update-available' }
  }
  return { ...withVersion, state: 'installable' }
}

const ROW_CONCURRENCY = 6

export async function listBuildRows(
  client: ComfyBuilderClient,
  host: Host,
  installed?: ReadonlyMap<string, number>,
  cacheGeneration?: number
): Promise<BuildRow[]> {
  return resolveBuildRows(client, host, await client.listBuilds(), installed, cacheGeneration)
}

export async function resolveBuildRows(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  builds: readonly Build[],
  installed?: ReadonlyMap<string, number>,
  cacheGeneration?: number
): Promise<BuildRow[]> {
  const rows: (BuildRow | undefined)[] = new Array<BuildRow | undefined>(builds.length)
  await runPool(builds, ROW_CONCURRENCY, async (build, index) => {
    try {
      rows[index] = await buildRow(client, host, build, installed, cacheGeneration)
    } catch (err) {
      console.error('[devplatform] failed to resolve build row:', err)
    }
  })
  return rows.filter((r): r is BuildRow => r !== undefined)
}

export async function resolveHostArtifact(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  buildId: string
): Promise<ResolvedHostArtifact | null> {
  const latest = latestTerminalVersion(await client.listVersions(buildId))
  if (!latest) return null
  const { artifacts } = await client.getVersion(latest.id)
  const artifact = selectArtifactForHost(artifacts, host)
  return artifact ? { artifact, version: latest.version } : null
}

export async function resolveSelectedHostArtifact(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  buildId: string,
  releaseVersion: number,
  artifactId: string
): Promise<ResolvedHostArtifact | null> {
  const release = (await client.listVersions(buildId)).find(
    (version) => version.version === releaseVersion && isTerminalRelease(version.status)
  )
  if (!release) return null
  const { artifacts } = await client.getVersion(release.id)
  const artifact = compatibleArtifactsForHost(artifacts, host).find(
    (candidate) => candidate.id === artifactId
  )
  return artifact ? { artifact, version: release.version } : null
}

export async function resolveHostArtifactForVersion(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  buildId: string,
  version: number
): Promise<ResolvedHostArtifact | null> {
  const target = (await client.listVersions(buildId)).find(
    (v) => v.version === version && isTerminalRelease(v.status)
  )
  if (!target) return null
  const { artifacts } = await client.getVersion(target.id)
  const artifact = selectArtifactForHost(artifacts, host)
  return artifact ? { artifact, version: target.version } : null
}

async function updateVersions(
  versions: BuildVersion[],
  host: Host,
  loadArtifacts: (id: string) => Promise<Artifact[]>
): Promise<number[]> {
  const eligible: number[] = []
  for (const version of versions) {
    if (version.status === 'complete') {
      eligible.push(version.version)
    } else if (version.status === 'stopped') {
      const artifact = selectArtifactForHost(await loadArtifacts(version.id), host)
      if (artifact) eligible.push(version.version)
    }
  }
  return eligible.sort((a, b) => b - a)
}

export async function listUpdateVersions(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  buildId: string,
  host: Host
): Promise<number[]> {
  return updateVersions(
    await client.listVersions(buildId),
    host,
    async (id) => (await client.getVersion(id)).artifacts
  )
}
