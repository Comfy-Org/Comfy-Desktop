/**
 * Model-manifest resolution: the models to stage for an install.
 *
 * The source of truth is the builder `/manifest` endpoint, keyed by version id.
 * The install record carries the version NUMBER, so the id is resolved from the
 * versions list first (pinned to the COMPLETE version the archive came from). A
 * fetch failure degrades to an empty manifest rather than failing an install
 * whose archive already downloaded, so a transient blip never wastes the build.
 *
 * `COMFY_BUILDER_MODELS_MANIFEST` (E2E only) overrides the endpoint with an
 * explicit manifest so a hermetic e2e can point every model at a local server.
 */
import fs from 'fs'

import type { ComfyBuilderClient } from './client'
import type { ModelManifest } from './types'

const EMPTY: ModelManifest = { models: [], modelPolicy: null, partnerNodePolicy: null }

/** Parse an override that is inline JSON (`{...}`) or a path to a JSON file. */
function loadOverride(value: string): ModelManifest {
  const raw = value.trimStart().startsWith('{') ? value : fs.readFileSync(value, 'utf8')
  const parsed = JSON.parse(raw) as Partial<ModelManifest>
  return {
    models: parsed.models ?? [],
    modelPolicy: parsed.modelPolicy ?? null,
    partnerNodePolicy: parsed.partnerNodePolicy ?? null
  }
}

/** Map a version NUMBER to the id of its complete version, or null. `complete`
 *  is the only terminal status in the builder's closed enum (queued | building
 *  | complete), so the manifest is read off the same version the archive came
 *  from (never a failed row that shares the number). */
async function resolveVersionId(
  client: Pick<ComfyBuilderClient, 'listVersions'>,
  distributionId: string,
  versionNumber: string
): Promise<string | null> {
  const versions = await client.listVersions(distributionId)
  const match = versions.find((v) => String(v.version) === versionNumber && v.status === 'complete')
  return match?.id ?? null
}

/**
 * The models to stage for an install. Returns an empty manifest (stage nothing)
 * when the version has none, cannot be resolved, or the fetch fails.
 */
export async function resolveModelManifest(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'fetchModelManifest'>,
  distributionId: string,
  version: string
): Promise<ModelManifest> {
  // Test seam, E2E-gated so a shipped build can't be fed attacker-chosen models.
  const override = process.env.COMFY_BUILDER_MODELS_MANIFEST
  if (override && process.env.E2E === '1') return loadOverride(override)

  try {
    const versionId = await resolveVersionId(client, distributionId, version)
    return versionId ? await client.fetchModelManifest(versionId) : EMPTY
  } catch (err) {
    console.warn('[comfybuilder] model manifest fetch failed; staging no models:', err)
    return EMPTY
  }
}
