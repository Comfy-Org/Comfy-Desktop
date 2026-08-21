/**
 * Build display + install-state policy: the UI layer, NOT the library.
 *
 * Builder gives raw builds, versions, and artifacts plus a pure host-matcher
 * (`selectArtifactForHost`). This module applies the product
 * policy on top: for each Desktop build it resolves the latest COMPLETE version,
 * asks whether an artifact exists for THIS host, and flattens that into a single
 * renderer-safe display row (`installable` / `no-build` / `platform-mismatch`).
 * The renderer renders the row and, on click, asks main to install by id: the
 * chosen artifact (and its download ref) never leaves the main process.
 *
 * `update-available` also lives here: given the installed version (passed in by
 * the handler from the installations store), a row whose newer complete version
 * has a host-runnable artifact is marked updatable. Plain `installed` (up to date)
 * stays a renderer concern: it de-dupes those tiles out of the grid.
 */
// Import from the library's leaf modules (not its barrel): these are pure and
// pull no Electron/filesystem side effects, so this policy module stays cheap to
// load and to unit-test.
import { hostOs, selectArtifactForHost } from '../comfybuilder/targets'
import type { Artifact, Build, Host } from '../comfybuilder/types'
import type { ComfyBuilderClient } from '../comfybuilder/client'
import { detectGPU } from '../lib/gpu'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { setCachedVersions } from './versionCache'

/**
 * Build tile states. `installable` / `no-build` / `platform-mismatch` are
 * decided from the catalog alone; `update-available` also needs the installed
 * version (passed in), and only fires when the newer version has a host-runnable
 * artifact (you can never "update" to a build with nothing for this machine).
 */
export type BuildRowState = 'installable' | 'no-build' | 'platform-mismatch' | 'update-available'

/** One renderer-safe build tile row. Field names mirror the renderer's
 *  `devplatform/types.ts` so swapping mocks for this stays mechanical. */
export interface BuildRow {
  id: string
  name: string
  description?: string
  version?: string
  /** ComfyUI version bundled by this build. TODO(builder-backend): the
   *  build metadata doesn't carry it yet, so this is currently never set. */
  comfyuiVersion?: string
  finishedAt?: string
  numCustomNodes?: number
  state: BuildRowState
  /** The installed version of this build, when one backs it. Set for both
   *  an up-to-date install and an `update-available` one; absent when not installed. */
  installedVersion?: number
  /** i18n suffix explaining a blocked state (see `devPlatform.build.blockedReason.*`). */
  blockedReason?: string
  /** On `platform-mismatch`, the OSes this build DOES target (`windows` / `mac`
   *  / `linux`), so the card can name a machine that would run it. */
  targetOs?: string[]
}

/** What `installBuild` resolves before it hands off to the install chain. */
export interface ResolvedHostArtifact {
  artifact: Artifact
  version: number
}

/** The signed-in host's build target: OS from the platform, GPU from detection. */
export async function resolveHost(): Promise<Host> {
  const gpu = await detectGPU().catch(() => null)
  // The library targets nvidia/amd/cpu/mps; an Intel dGPU (or none) maps to the
  // universal CPU build, which `selectArtifactForHost` treats as the fallback.
  const mapped = gpu?.id === 'nvidia' || gpu?.id === 'amd' || gpu?.id === 'mps' ? gpu.id : 'cpu'
  return { os: hostOs(), gpu: mapped }
}

/** Latest complete version, or null. `complete` is the only terminal status in
 *  the builder's closed enum (queued | building | complete). */
function latestCompleteVersion<T extends { version: number; status: string }>(
  versions: T[]
): T | null {
  const complete = versions
    .filter((v) => v.status === 'complete')
    .sort((a, b) => b.version - a.version)
  return complete[0] ?? null
}

/**
 * Resolve one catalog entry into a build display row: newest complete
 * version, then whether it has a host-runnable artifact. Never drops the build: an
 * un-installable one becomes a blocked row with a reason, not a hidden entry.
 */
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
    ...(typeof build.numCustomNodes === 'number' ? { numCustomNodes: build.numCustomNodes } : {}),
    state: 'no-build'
  }

  const allVersions = await client.listVersions(build.id)
  // The manage view's version picker is built synchronously and can't fetch, so
  // hand it what this read already saw.
  setCachedVersions(
    build.id,
    allVersions.filter((v) => v.status === 'complete').map((v) => v.version),
    cacheGeneration
  )

  const latest = latestCompleteVersion(allVersions)
  if (!latest) {
    // A version still queued/building is "in progress", not "failed" - the
    // builder's status enum has no failed state, so any non-complete version
    // is pending work.
    const pending = allVersions.some((v) => v.status === 'queued' || v.status === 'building')
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
  const artifact = selectArtifactForHost(artifacts, host)
  if (!artifact) {
    // Sorted so the label is stable across artifact orderings.
    const targetOs = [
      ...new Set(artifacts.filter((a) => a.status === 'ready').map((a) => a.os))
    ].sort()
    return {
      ...withVersion,
      state: 'platform-mismatch',
      blockedReason: 'noArtifactForMachine',
      ...(targetOs.length ? { targetOs } : {})
    }
  }
  // Installed at an older version, and the newer one runs here: offer the update.
  if (installedVersion !== undefined && latest.version > installedVersion) {
    return { ...withVersion, state: 'update-available' }
  }
  return { ...withVersion, state: 'installable' }
}

/**
 * Every build the signed-in workspace can see, as display rows. A build whose
 * version lookup fails is dropped for THIS list rather than
 * failing the whole grid. Rows resolve through a bounded pool: each one costs
 * two gateway requests (listVersions + getVersion), so an unbounded map over a
 * large catalog would fire 2N concurrent requests and trip rate limits.
 */
const ROW_CONCURRENCY = 6

export async function listBuildRows(
  client: ComfyBuilderClient,
  host: Host,
  installed?: ReadonlyMap<string, number>,
  cacheGeneration?: number
): Promise<BuildRow[]> {
  return resolveBuildRows(client, host, await client.listBuilds(), installed, cacheGeneration)
}

/** Resolve an already-fetched catalog without requesting the list again. */
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

/**
 * Resolve the artifact to install for one build on this host: the latest
 * complete version's host-matched artifact, or null when none is runnable here.
 * This is the same policy `listBuildRows` renders, re-run at install time
 * against fresh catalog data.
 */
export async function resolveHostArtifact(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  buildId: string
): Promise<ResolvedHostArtifact | null> {
  const latest = latestCompleteVersion(await client.listVersions(buildId))
  if (!latest) return null
  const { artifacts } = await client.getVersion(latest.id)
  const artifact = selectArtifactForHost(artifacts, host)
  return artifact ? { artifact, version: latest.version } : null
}

/**
 * The same resolution against ONE named version - what the manage view's update
 * action installs. Rollback and roll-forward are the same operation.
 *
 * Null when the version isn't published, isn't complete, or has no artifact this
 * machine can run, so the caller reports that instead of installing something
 * the host can't launch.
 */
export async function resolveHostArtifactForVersion(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  buildId: string,
  version: number
): Promise<ResolvedHostArtifact | null> {
  const target = (await client.listVersions(buildId)).find(
    (v) => v.version === version && v.status === 'complete'
  )
  if (!target) return null
  const { artifacts } = await client.getVersion(target.id)
  const artifact = selectArtifactForHost(artifacts, host)
  return artifact ? { artifact, version: target.version } : null
}

/** Every complete version, newest first - what the manage view reports as
 *  published, and the basis for a future version picker. */
export async function listCompleteVersions(
  client: Pick<ComfyBuilderClient, 'listVersions'>,
  buildId: string
): Promise<number[]> {
  const versions = await client.listVersions(buildId)
  return versions
    .filter((v) => v.status === 'complete')
    .map((v) => v.version)
    .sort((a, b) => b - a)
}
