/** Resolve the selected terminal release's sealed models; transfer belongs to staging.
 * Lookup failures must fail installation rather than masquerade as an empty manifest. */
import fs from 'fs'

import type { ComfyBuilderClient } from './client'
import { isTerminalRelease } from './releases'
import type { ModelManifest } from './types'

/** Parse an override that is inline JSON (`{...}`) or a path to a JSON file. */
function loadOverride(value: string): ModelManifest {
  const raw = value.trimStart().startsWith('{') ? value : fs.readFileSync(value, 'utf8')
  const parsed = JSON.parse(raw) as Partial<ModelManifest>
  return {
    models: parsed.models ?? [],
    modelPolicy: parsed.modelPolicy ?? null,
    partnerNodePolicy: parsed.partnerNodePolicy ?? null,
    customNodePolicy: parsed.customNodePolicy ?? null
  }
}

/** Resolve the exact selected version, including stopped releases with ready siblings.
 * Never substitute another version when the selected release is unavailable. */
async function resolveVersionId(
  client: Pick<ComfyBuilderClient, 'listVersions'>,
  buildId: string,
  versionNumber: string
): Promise<string | null> {
  const versions = await client.listVersions(buildId)
  const match = versions.find(
    (v) => String(v.version) === versionNumber && isTerminalRelease(v.status)
  )
  return match?.id ?? null
}

/**
 * The models to stage for an install. Returns an empty manifest only when the
 * resolved manifest declares no models.
 */
export async function resolveModelManifest(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'fetchModelManifest'>,
  buildId: string,
  version: string
): Promise<ModelManifest> {
  // Test seam, E2E-gated so a shipped build can't be fed attacker-chosen models.
  const override = process.env.COMFY_BUILDER_MODELS_MANIFEST
  if (override && process.env.E2E === '1') return loadOverride(override)

  const versionId = await resolveVersionId(client, buildId, version)
  if (!versionId) {
    throw new Error(`No complete or stopped build version ${version} was found for model staging.`)
  }
  return client.fetchModelManifest(versionId)
}
