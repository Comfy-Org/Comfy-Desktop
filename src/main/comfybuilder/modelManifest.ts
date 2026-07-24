/**
 * Model-manifest resolution: where the install's model list comes from.
 *
 * The builder API endpoint that serves a version's models is not deployed yet,
 * so by default this returns a small STATIC per-distribution mock (below) so the
 * Desktop model-staging path can ship and be exercised end to end. Two other
 * sources take precedence, in order:
 *
 *   1. `COMFY_BUILDER_MODELS_MANIFEST` (env): an explicit manifest as inline
 *      JSON or a file path. The test/e2e seam, so a hermetic run can point every
 *      model at a local server without touching product code.
 *   2. `COMFY_BUILDER_MODELS_LIVE=1` (env): the real endpoint. The install
 *      record carries the version NUMBER, not the version id the endpoint is
 *      keyed by, so the id is resolved from the versions list first.
 *
 * When the endpoint ships, LIVE becomes the default and the mock is deleted; the
 * `ComfyBuilderClient.fetchModelManifest` call in the LIVE branch is already the
 * final shape.
 */
import fs from 'fs'

import type { ComfyBuilderClient } from './client'
import type { ModelManifest } from './types'

/** What the resolver needs off an install record to find its manifest. */
export interface ManifestKey {
  distributionId: string
  /** The version NUMBER as stored on the record (e.g. "1"). */
  version: string
}

const EMPTY: ModelManifest = { models: [], modelPolicy: null, partnerNodePolicy: null }

/**
 * TEMPORARY static mock, keyed by distribution id, until the builder `/manifest`
 * endpoint is deployed. The models are small, public, no-auth files so a real
 * install genuinely downloads and stages them. Delete this whole map (and the
 * mock branch below) once LIVE is the default.
 */
const TAESD_BASE = 'https://github.com/madebyollin/taesd/raw/main'
const MOCK_MANIFESTS: Record<string, ModelManifest> = {
  // desktop-4target-stg-v0190
  '0b78fc4e-5b7e-47bf-b64b-b59835eb2452': {
    models: [
      {
        type: 'vae_approx',
        filename: 'taesd_decoder.pth',
        sha256: '02873377c3f4659cd9f9adb2f718dcb434ba4c7bba3af3ee7bb95cbdabe2d3cf',
        downloadUrl: `${TAESD_BASE}/taesd_decoder.pth`,
      },
    ],
    modelPolicy: null,
    partnerNodePolicy: null,
  },
  // desktop-complex-manager-stg
  '75ea3944-b9c4-475b-a68b-35198eea0214': {
    models: [
      {
        type: 'vae_approx',
        filename: 'taesd_decoder.pth',
        sha256: '02873377c3f4659cd9f9adb2f718dcb434ba4c7bba3af3ee7bb95cbdabe2d3cf',
        downloadUrl: `${TAESD_BASE}/taesd_decoder.pth`,
      },
      {
        type: 'vae_approx',
        filename: 'taesd_encoder.pth',
        sha256: '15bc6128f0ac51c673d3427216082ebfa62402ffc89763af74edfe259b32d49d',
        downloadUrl: `${TAESD_BASE}/taesd_encoder.pth`,
      },
    ],
    modelPolicy: { mode: 'allowlist', list: ['taesd_decoder.pth', 'taesd_encoder.pth'] },
    partnerNodePolicy: null,
  },
}

/** Parse an override that is either inline JSON (`{...}`) or a path to a JSON file. */
function loadOverride(value: string): ModelManifest {
  const raw = value.trimStart().startsWith('{') ? value : fs.readFileSync(value, 'utf8')
  const parsed = JSON.parse(raw) as Partial<ModelManifest>
  return {
    models: parsed.models ?? [],
    modelPolicy: parsed.modelPolicy ?? null,
    partnerNodePolicy: parsed.partnerNodePolicy ?? null,
  }
}

// A version whose build finished, mirroring the set the install artifact was
// selected from, so the manifest is resolved off the same version the archive
// came from (and never a failed/incomplete row that shares the number).
const COMPLETE_VERSION_STATUSES = new Set(['complete', 'completed', 'ready', 'succeeded', 'success'])

/** Map a version NUMBER to the id of its COMPLETE version, or null. Matching on
 *  number alone could pick a failed row that shares the number; the install
 *  artifact came from the complete one, so pin to that. */
async function resolveVersionId(
  client: Pick<ComfyBuilderClient, 'listVersions'>,
  distributionId: string,
  versionNumber: string,
): Promise<string | null> {
  const versions = await client.listVersions(distributionId)
  const match = versions.find(
    (v) =>
      String(v.version) === versionNumber &&
      typeof v.status === 'string' &&
      COMPLETE_VERSION_STATUSES.has(v.status.toLowerCase()),
  )
  return match?.id ?? null
}

/**
 * Resolve the manifest for an install. Never throws for "no models": an unknown
 * distribution (or a version with none) returns an empty manifest so the install
 * simply stages nothing.
 */
export async function resolveModelManifest(
  key: ManifestKey,
  client: Pick<ComfyBuilderClient, 'listVersions' | 'fetchModelManifest'>,
): Promise<ModelManifest> {
  // The inline/file override is a test seam: gate it behind E2E so a shipped
  // build can't be made to stage attacker-chosen models via a stray env var.
  const override = process.env.COMFY_BUILDER_MODELS_MANIFEST
  if (override && process.env.E2E === '1') return loadOverride(override)

  if (process.env.COMFY_BUILDER_MODELS_LIVE === '1') {
    const versionId = await resolveVersionId(client, key.distributionId, key.version)
    return versionId ? client.fetchModelManifest(versionId) : EMPTY
  }

  return MOCK_MANIFESTS[key.distributionId] ?? EMPTY
}
