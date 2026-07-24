// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveModelManifest } from './modelManifest'
import type { ModelManifest } from './types'

const KNOWN_DIST = '0b78fc4e-5b7e-47bf-b64b-b59835eb2452' // desktop-4target-stg-v0190

// A client stub with just the two methods the resolver may call.
function client(over: Partial<{ listVersions: unknown; fetchModelManifest: unknown }> = {}) {
  return {
    listVersions: vi.fn(async () => [{ id: 'ver-1', version: 1, status: 'complete' }]),
    fetchModelManifest: vi.fn(async () => ({ models: [], modelPolicy: null, partnerNodePolicy: null })),
    ...over,
  } as never
}

const ENV_KEYS = ['COMFY_BUILDER_MODELS_MANIFEST', 'COMFY_BUILDER_MODELS_LIVE']
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  vi.restoreAllMocks()
})

describe('resolveModelManifest', () => {
  it('returns the static mock for a known distribution by default', async () => {
    const m = await resolveModelManifest({ distributionId: KNOWN_DIST, version: '1' }, client())
    expect(m.models.length).toBeGreaterThan(0)
    expect(m.models[0]!.type).toBe('vae_approx')
  })

  it('returns an empty manifest for an unknown distribution by default', async () => {
    const m = await resolveModelManifest({ distributionId: 'unknown', version: '1' }, client())
    expect(m.models).toEqual([])
  })

  it('honors an inline-JSON override (the e2e seam)', async () => {
    const override: ModelManifest = {
      models: [{ type: 'checkpoints', filename: 'x.safetensors', downloadUrl: 'http://127.0.0.1:1/x' }],
      modelPolicy: null,
      partnerNodePolicy: null,
    }
    process.env.COMFY_BUILDER_MODELS_MANIFEST = JSON.stringify(override)
    const m = await resolveModelManifest({ distributionId: KNOWN_DIST, version: '1' }, client())
    expect(m.models).toEqual(override.models)
  })

  it('honors a file-path override', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mf-'))
    const file = path.join(dir, 'manifest.json')
    fs.writeFileSync(file, JSON.stringify({ models: [{ type: 'vae', filename: 'v.pt', downloadUrl: 'http://h/v' }] }))
    process.env.COMFY_BUILDER_MODELS_MANIFEST = file
    const m = await resolveModelManifest({ distributionId: 'unknown', version: '1' }, client())
    expect(m.models[0]!.filename).toBe('v.pt')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('LIVE=1 resolves the version id and calls the real endpoint', async () => {
    process.env.COMFY_BUILDER_MODELS_LIVE = '1'
    const live: ModelManifest = {
      models: [{ type: 'loras', filename: 'l.safetensors', downloadUrl: 'https://signed/l' }],
      modelPolicy: null,
      partnerNodePolicy: null,
    }
    const c = client({
      listVersions: vi.fn(async () => [{ id: 'ver-42', version: 3, status: 'complete' }]),
      fetchModelManifest: vi.fn(async () => live),
    })
    const m = await resolveModelManifest({ distributionId: KNOWN_DIST, version: '3' }, c)
    expect((c as unknown as { fetchModelManifest: ReturnType<typeof vi.fn> }).fetchModelManifest).toHaveBeenCalledWith('ver-42')
    expect(m.models).toEqual(live.models)
  })

  it('LIVE=1 with no matching version stages nothing', async () => {
    process.env.COMFY_BUILDER_MODELS_LIVE = '1'
    const c = client({ listVersions: vi.fn(async () => [{ id: 'ver-1', version: 1, status: 'complete' }]) })
    const m = await resolveModelManifest({ distributionId: KNOWN_DIST, version: '99' }, c)
    expect(m.models).toEqual([])
    expect((c as unknown as { fetchModelManifest: ReturnType<typeof vi.fn> }).fetchModelManifest).not.toHaveBeenCalled()
  })
})
