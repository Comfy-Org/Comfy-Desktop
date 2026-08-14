// @vitest-environment node
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The guard tests never reach download/extract; stub them so importing install.ts
// does not pull Electron (`net`) or 7zip-bin into this unit test.
vi.mock('../lib/download', () => ({ download: vi.fn() }))
vi.mock('../lib/extract', () => ({ extractNested: vi.fn() }))

import { download } from '../lib/download'
import { installArtifact } from './install'
import type { Artifact, InstallProgress } from './types'

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

  it.each([
    ['absent', undefined],
    ['blank', '   '],
    ['prefix-only', 'sha256:']
  ])('fails before download when archiveSha256 is %s', async (name, sha) => {
    const client = { resolveDownloadUrl: vi.fn(async () => 'https://example.test/a.tar.gz') }
    await expect(
      installArtifact({
        artifact: artifact({ archiveSha256: sha }),
        client,
        installPath: path.join(os.tmpdir(), `cb-${name}`),
        cacheDir: os.tmpdir()
      })
    ).rejects.toMatchObject({ kind: 'invalid-artifact' })
    expect(client.resolveDownloadUrl).not.toHaveBeenCalled()
  })
})

describe('installArtifact download progress', () => {
  it('surfaces bytes, speed, and ETA in the download detail line', async () => {
    const seen: InstallProgress[] = []
    vi.mocked(download).mockImplementationOnce(async (_url, _dest, onProgress) => {
      onProgress?.({
        percent: 15,
        receivedBytes: 125_829_120,
        receivedMB: '120.0',
        totalMB: '800.0',
        speedMBs: 22.1,
        elapsedSecs: 5,
        etaSecs: 31
      })
      throw new Error('stop after progress')
    })
    const client = { resolveDownloadUrl: vi.fn(async () => 'https://example.test/a.tar.gz') }
    await expect(
      installArtifact({
        artifact: artifact({ archiveSha256: 'a'.repeat(64) }),
        client,
        installPath: path.join(os.tmpdir(), 'cb-progress'),
        cacheDir: path.join(os.tmpdir(), 'cb-progress-cache'),
        onProgress: (p) => seen.push(p)
      })
    ).rejects.toThrow('stop after progress')
    const detail = seen.find((p) => p.phase === 'download' && p.detail)?.detail
    expect(detail).toBe('120.0 / 800.0 MB  ·  22.1 MB/s  ·  5s elapsed  ·  31s remaining')
  })
})
