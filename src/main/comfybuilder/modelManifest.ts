import fs from 'fs'

import type { ComfyBuilderClient } from './client'
import type { ModelManifest } from './types'

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

async function resolveVersionId(
  client: Pick<ComfyBuilderClient, 'listVersions'>,
  buildId: string,
  versionNumber: string
): Promise<string | null> {
  const versions = await client.listVersions(buildId)
  const match = versions.find((v) => String(v.version) === versionNumber && v.status === 'complete')
  return match?.id ?? null
}

export async function resolveModelManifest(
  client: Pick<ComfyBuilderClient, 'listVersions' | 'fetchModelManifest'>,
  buildId: string,
  version: string
): Promise<ModelManifest> {
  const override = process.env.COMFY_BUILDER_MODELS_MANIFEST
  if (override && process.env.E2E === '1') return loadOverride(override)

  const versionId = await resolveVersionId(client, buildId, version)
  if (!versionId) {
    throw new Error(`No complete build version ${version} was found for model staging.`)
  }
  return client.fetchModelManifest(versionId)
}
