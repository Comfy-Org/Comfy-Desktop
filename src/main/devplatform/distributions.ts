/**
 * Distribution display + install-state policy: the UI layer, NOT the library.
 *
 * The comfy-builder library gives raw distributions / versions / artifacts and a
 * pure host-matcher (`selectArtifactForHost`). This module applies the product
 * policy on top: for each distribution it resolves the latest COMPLETE version,
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
import type { Artifact, Distribution, Host } from '../comfybuilder/types'
import type { ComfyBuilderClient } from '../comfybuilder/client'
import { detectGPU } from '../lib/gpu'

/**
 * Distribution tile states. `installable` / `no-build` / `platform-mismatch` are
 * decided from the catalog alone; `update-available` also needs the installed
 * version (passed in), and only fires when the newer version has a host-runnable
 * artifact (you can never "update" to a build with nothing for this machine).
 */
export type DistributionRowState =
  | 'installable'
  | 'no-build'
  | 'platform-mismatch'
  | 'update-available'

/** One renderer-safe distribution tile row. Field names mirror the renderer's
 *  `devplatform/types.ts` so swapping mocks for this stays mechanical. */
export interface DistributionRow {
  id: string
  name: string
  description?: string
  version?: string
  /** ComfyUI version bundled by this distribution. TODO(builder-backend): the
   *  build metadata doesn't carry it yet, so this is currently never set. */
  comfyuiVersion?: string
  finishedAt?: string
  numCustomNodes?: number
  state: DistributionRowState
  /** The installed version of this distribution, when one backs it. Set for both
   *  an up-to-date install and an `update-available` one; absent when not installed. */
  installedVersion?: number
  /** i18n suffix explaining a blocked state (see `devPlatform.distribution.blockedReason.*`). */
  blockedReason?: string
  /** On `platform-mismatch`, the OSes this build DOES target (`windows` / `mac`
   *  / `linux`), so the card can name a machine that would run it. */
  targetOs?: string[]
}

/** What `installDistribution` resolves before it hands off to the install chain. */
export interface ResolvedHostArtifact {
  artifact: Artifact
  version: number
}

/** The signed-in host's build target: OS from the platform, GPU from detection. */
export async function resolveHost(): Promise<Host> {
  const gpu = await detectGPU().catch(() => null)
  // The library targets nvidia/amd/cpu/mps; an Intel dGPU (or none) maps to the
  // universal CPU build, which `selectArtifactForHost` treats as the fallback.
  const mapped =
    gpu?.id === 'nvidia' || gpu?.id === 'amd' || gpu?.id === 'mps' ? gpu.id : 'cpu'
  return { os: hostOs(), gpu: mapped }
}

/** Latest complete version, or null. `complete` is the only terminal status in
 *  the builder's closed enum (queued | building | complete). */
function latestCompleteVersion<T extends { version: number; status: string }>(versions: T[]): T | null {
  const complete = versions
    .filter((v) => v.status === 'complete')
    .sort((a, b) => b.version - a.version)
  return complete[0] ?? null
}

/**
 * Resolve one distribution into a display row: newest complete version, then
 * whether it has a host-runnable artifact. Never drops the distribution: an
 * un-installable one becomes a blocked row with a reason, not a hidden entry.
 */
async function buildRow(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  dist: Distribution,
  installed?: ReadonlyMap<string, number>,
): Promise<DistributionRow> {
  const base: DistributionRow = {
    id: dist.id,
    name: dist.name,
    ...(dist.description ? { description: dist.description } : {}),
    ...(typeof dist.numCustomNodes === 'number' ? { numCustomNodes: dist.numCustomNodes } : {}),
    state: 'no-build',
  }

  const latest = latestCompleteVersion(await client.listVersions(dist.id))
  if (!latest) return { ...base, state: 'no-build', blockedReason: 'buildFailed' }

  const installedVersion = installed?.get(dist.id)
  const withVersion: DistributionRow = {
    ...base,
    version: String(latest.version),
    ...(latest.createdAt ? { finishedAt: latest.createdAt } : {}),
    ...(installedVersion !== undefined ? { installedVersion } : {}),
  }

  const { artifacts } = await client.getVersion(latest.id)
  const artifact = selectArtifactForHost(artifacts, host)
  if (!artifact) {
    // Sorted so the label is stable across artifact orderings.
    const targetOs = [...new Set(artifacts.filter((a) => a.status === 'ready').map((a) => a.os))].sort()
    return {
      ...withVersion,
      state: 'platform-mismatch',
      blockedReason: 'noArtifactForMachine',
      ...(targetOs.length ? { targetOs } : {}),
    }
  }
  // Installed at an older version, and the newer one runs here: offer the update.
  if (installedVersion !== undefined && latest.version > installedVersion) {
    return { ...withVersion, state: 'update-available' }
  }
  return { ...withVersion, state: 'installable' }
}

/**
 * Every distribution the signed-in workspace can see, as display rows. A
 * distribution whose version lookup fails is dropped for THIS list rather than
 * failing the whole grid.
 */
export async function listDistributionRows(
  client: ComfyBuilderClient,
  host: Host,
  installed?: ReadonlyMap<string, number>,
): Promise<DistributionRow[]> {
  const dists = await client.listDistributions()
  const results = await Promise.allSettled(dists.map((d) => buildRow(client, host, d, installed)))
  return results
    .filter((r): r is PromiseFulfilledResult<DistributionRow> => {
      if (r.status === 'rejected') console.error('[devplatform] failed to resolve distribution row:', r.reason)
      return r.status === 'fulfilled'
    })
    .map((r) => r.value)
}

/**
 * Resolve the artifact to install for one distribution on this host: the latest
 * complete version's host-matched artifact, or null when none is runnable here.
 * This is the same policy `listDistributionRows` renders, re-run at install time
 * against fresh catalog data.
 */
export async function resolveHostArtifact(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  distributionId: string,
): Promise<ResolvedHostArtifact | null> {
  const latest = latestCompleteVersion(await client.listVersions(distributionId))
  if (!latest) return null
  const { artifacts } = await client.getVersion(latest.id)
  const artifact = selectArtifactForHost(artifacts, host)
  return artifact ? { artifact, version: latest.version } : null
}
