/**
 * Distribution display + install-state policy — the UI layer, NOT the library.
 *
 * The comfy-builder library gives raw distributions / versions / artifacts and a
 * pure host-matcher (`selectArtifactForHost`). This module applies the product
 * policy on top: for each distribution it resolves the latest COMPLETE version,
 * asks whether an artifact exists for THIS host, and flattens that into a single
 * renderer-safe display row (`installable` / `no-build` / `platform-mismatch`).
 * The renderer renders the row and, on click, asks main to install by id — the
 * chosen artifact (and its download ref) never leaves the main process.
 *
 * `installed` / `update-available` are LOCAL states owned by the renderer (it
 * de-dupes against the installations store), so they are deliberately absent
 * here.
 */
// Import from the library's leaf modules (not its barrel): these are pure and
// pull no Electron/filesystem side effects, so this policy module stays cheap to
// load and to unit-test.
import { hostOs, selectArtifactForHost } from '../comfybuilder/targets'
import type { Artifact, Distribution, Host } from '../comfybuilder/types'
import type { ComfyBuilderClient } from '../comfybuilder/client'
import { detectGPU } from '../lib/gpu'

/** The pre-install states this layer can decide from the catalog alone. */
export type DistributionRowState = 'installable' | 'no-build' | 'platform-mismatch'

/** One renderer-safe distribution tile row. Field names mirror the renderer's
 *  `devplatform/types.ts` so swapping mocks for this stays mechanical. */
export interface DistributionRow {
  id: string
  name: string
  description?: string
  version?: string
  finishedAt?: string
  numCustomNodes?: number
  state: DistributionRowState
  /** i18n suffix explaining a blocked state (see `devPlatform.distribution.blockedReason.*`). */
  blockedReason?: string
}

/** What `installDistribution` resolves before it hands off to the install chain. */
export interface ResolvedHostArtifact {
  artifact: Artifact
  version: number
}

/**
 * Terminal-success version statuses. Kept lenient (the builder's exact wording
 * has drifted) so a completed build is never mistaken for a missing one.
 */
const COMPLETE_VERSION_STATUSES = new Set(['complete', 'completed', 'ready', 'succeeded', 'success'])

/** The signed-in host's build target: OS from the platform, GPU from detection. */
export async function resolveHost(): Promise<Host> {
  const gpu = await detectGPU().catch(() => null)
  // The library targets nvidia/amd/cpu/mps; an Intel dGPU (or none) maps to the
  // universal CPU build, which `selectArtifactForHost` treats as the fallback.
  const mapped =
    gpu?.id === 'nvidia' || gpu?.id === 'amd' || gpu?.id === 'mps' ? gpu.id : 'cpu'
  return { os: hostOs(), gpu: mapped }
}

/** Latest version whose status reads as a completed build, or null. */
function latestCompleteVersion<T extends { version: number; status: string }>(versions: T[]): T | null {
  const complete = versions
    .filter((v) => COMPLETE_VERSION_STATUSES.has(v.status.toLowerCase()))
    .sort((a, b) => b.version - a.version)
  return complete[0] ?? null
}

/**
 * Resolve one distribution into a display row: newest complete version, then
 * whether it has a host-runnable artifact. Never drops the distribution — an
 * un-installable one becomes a blocked row with a reason, not a hidden entry.
 */
async function buildRow(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'getVersion'>,
  host: Host,
  dist: Distribution,
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

  const withVersion: DistributionRow = {
    ...base,
    version: String(latest.version),
    ...(latest.createdAt ? { finishedAt: latest.createdAt } : {}),
  }

  const { artifacts } = await client.getVersion(latest.id)
  const artifact = selectArtifactForHost(artifacts, host)
  if (!artifact) return { ...withVersion, state: 'platform-mismatch', blockedReason: 'noArtifactForMachine' }
  return { ...withVersion, state: 'installable' }
}

/**
 * Every distribution the signed-in workspace can see, as display rows. A
 * distribution whose version lookup fails is dropped for THIS list rather than
 * failing the whole grid.
 */
export async function listDistributionRows(client: ComfyBuilderClient, host: Host): Promise<DistributionRow[]> {
  const dists = await client.listDistributions()
  const results = await Promise.allSettled(dists.map((d) => buildRow(client, host, d)))
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
