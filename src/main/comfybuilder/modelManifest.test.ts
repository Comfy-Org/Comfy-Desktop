// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveModelManifest } from './modelManifest'
import type { ModelManifest } from './types'

const MODEL_SHA = 'a'.repeat(64)
const MANIFEST: ModelManifest = {
  models: [
    { type: 'loras', filename: 'l.safetensors', sha256: MODEL_SHA, downloadUrl: 'https://signed/l' }
  ],
  modelPolicy: null,
  partnerNodePolicy: null
}

// A client stub with just the two methods the resolver calls.
function client(over: Partial<{ listVersions: unknown; fetchModelManifest: unknown }> = {}) {
  return {
    listVersions: vi.fn(async () => [{ id: 'ver-1', version: 1, status: 'complete' }]),
    fetchModelManifest: vi.fn(async () => MANIFEST),
    ...over
  } as never
}

afterEach(() => {
  delete process.env.COMFY_BUILDER_MODELS_MANIFEST
  delete process.env.E2E
  vi.restoreAllMocks()
})

describe('resolveModelManifest', () => {
  it('resolves the version id then fetches its manifest', async () => {
    const c = client({
      listVersions: vi.fn(async () => [{ id: 'ver-42', version: 3, status: 'complete' }]),
      fetchModelManifest: vi.fn(async () => MANIFEST)
    })
    const m = await resolveModelManifest(c, 'd1', '3')
    expect(
      (c as unknown as { fetchModelManifest: ReturnType<typeof vi.fn> }).fetchModelManifest
    ).toHaveBeenCalledWith('ver-42')
    expect(m.models).toEqual(MANIFEST.models)
  })

  it('pins the COMPLETE version when a failed row shares the number', async () => {
    const c = client({
      listVersions: vi.fn(async () => [
        { id: 'ver-bad', version: 5, status: 'failed' },
        { id: 'ver-good', version: 5, status: 'complete' }
      ])
    })
    await resolveModelManifest(c, 'd1', '5')
    expect(
      (c as unknown as { fetchModelManifest: ReturnType<typeof vi.fn> }).fetchModelManifest
    ).toHaveBeenCalledWith('ver-good')
  })

  it('fails when no matching complete version resolves', async () => {
    const c = client({
      listVersions: vi.fn(async () => [{ id: 'ver-1', version: 1, status: 'complete' }])
    })
    await expect(resolveModelManifest(c, 'd1', '99')).rejects.toThrow(
      'No complete distribution version 99'
    )
    expect(
      (c as unknown as { fetchModelManifest: ReturnType<typeof vi.fn> }).fetchModelManifest
    ).not.toHaveBeenCalled()
  })

  it('fails rather than silently skipping required models when the fetch fails', async () => {
    const c = client({
      fetchModelManifest: vi.fn(async () => {
        throw new Error('boom')
      })
    })
    await expect(resolveModelManifest(c, 'd1', '1')).rejects.toThrow('boom')
  })

  it('honors an inline-JSON override only under E2E (the test seam)', async () => {
    const override: ModelManifest = {
      models: [
        {
          type: 'checkpoints',
          filename: 'x.safetensors',
          sha256: MODEL_SHA,
          downloadUrl: 'https://h/x'
        }
      ],
      modelPolicy: null,
      partnerNodePolicy: null
    }
    process.env.COMFY_BUILDER_MODELS_MANIFEST = JSON.stringify(override)
    process.env.E2E = '1'
    const c = client()
    const m = await resolveModelManifest(c, 'd1', '1')
    expect(m.models).toEqual(override.models)
    expect(
      (c as unknown as { listVersions: ReturnType<typeof vi.fn> }).listVersions
    ).not.toHaveBeenCalled()
  })

  it('ignores the override in a non-E2E build (falls through to the endpoint)', async () => {
    process.env.COMFY_BUILDER_MODELS_MANIFEST = JSON.stringify({
      models: [{ type: 'x', filename: 'evil', sha256: MODEL_SHA, downloadUrl: 'https://evil/x' }]
    })
    const m = await resolveModelManifest(client(), 'd1', '1')
    expect(m.models).toEqual(MANIFEST.models) // the fetched manifest, not the injected one
  })

  it('honors a file-path override under E2E', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mf-'))
    const file = path.join(dir, 'manifest.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        models: [{ type: 'vae', filename: 'v.pt', sha256: MODEL_SHA, downloadUrl: 'https://h/v' }]
      })
    )
    process.env.COMFY_BUILDER_MODELS_MANIFEST = file
    process.env.E2E = '1'
    const m = await resolveModelManifest(client(), 'd1', '1')
    expect(m.models[0]!.filename).toBe('v.pt')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
