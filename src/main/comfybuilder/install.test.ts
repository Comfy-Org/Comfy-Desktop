// @vitest-environment node
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The guard tests never reach download/extract; stub them so importing install.ts
// does not pull Electron (`net`) or 7zip-bin into this unit test.
vi.mock('../lib/download', () => ({ download: vi.fn() }))
vi.mock('../lib/extract', () => ({ extractNested: vi.fn() }))

import { installArtifact } from './install'
import type { Artifact } from './types'

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'a1',
  os: 'linux',
  gpu: 'cpu',
  accelVariant: 'cpu',
  status: 'ready',
  ...overrides
})

describe('installArtifact guards', () => {
  it('rejects a missing artifact id before any work', async () => {
    const client = { resolveDownloadUrl: vi.fn() }
    await expect(
      installArtifact({
        artifact: { ...artifact(), id: '' },
        client,
        installPath: '/x',
        cacheDir: os.tmpdir()
      })
    ).rejects.toMatchObject({ kind: 'invalid-artifact' })
    expect(client.resolveDownloadUrl).not.toHaveBeenCalled()
  })

  // TODO: flip back to fail-closed once the builder populates archiveSha256.
  it.each([
    ['absent', undefined],
    ['blank', '   '],
    ['prefix-only', 'sha256:']
  ])('proceeds (unverified) when archiveSha256 is %s', async (name, sha) => {
    const client = { resolveDownloadUrl: vi.fn(async () => 'https://example.test/a.tar.gz') }
    // Gets past the hash gate: the stubbed extract writes no layout, so it fails
    // on the layout check rather than on the missing hash.
    await expect(
      installArtifact({
        artifact: artifact({ archiveSha256: sha }),
        client,
        installPath: path.join(os.tmpdir(), `cb-${name}`),
        cacheDir: os.tmpdir()
      })
    ).rejects.toMatchObject({ kind: 'invalid-layout' })
    expect(client.resolveDownloadUrl).toHaveBeenCalled()
  })
})
