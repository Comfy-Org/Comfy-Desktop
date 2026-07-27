// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { listDistributionRows, resolveHostArtifact } from './distributions'
import type { Artifact, Distribution, DistributionVersion, Host } from '../comfybuilder'

const HOST: Host = { os: 'linux', gpu: 'nvidia' }

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art-1',
    os: 'linux',
    gpu: 'nvidia',
    accelVariant: 'cu128',
    status: 'ready',
    archiveSha256: 'abc',
    ...overrides,
  }
}

function version(v: number, status: string): DistributionVersion {
  return { id: `v${v}`, version: v, status, createdAt: '2026-07-20T00:00:00Z' }
}

/** A stub client whose per-distribution / per-version data is table-driven. */
function stubClient(opts: {
  distributions?: Distribution[]
  versionsByDist?: Record<string, DistributionVersion[]>
  artifactsByVersion?: Record<string, Artifact[]>
}) {
  return {
    listDistributions: vi.fn(async () => opts.distributions ?? []),
    listVersions: vi.fn(async (id: string) => opts.versionsByDist?.[id] ?? []),
    getVersion: vi.fn(async (id: string) => ({ version: Number(id.replace('v', '')), artifacts: opts.artifactsByVersion?.[id] ?? [] })),
  }
}

describe('listDistributionRows', () => {
  it('marks a distribution installable when the latest complete version has a host artifact', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'Image', description: 'desc', numCustomNodes: 3 }],
      versionsByDist: { d1: [version(1, 'complete'), version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] },
    })
    const rows = await listDistributionRows(client as never, HOST)
    const row = rows[0]!
    expect(row).toMatchObject({ id: 'd1', name: 'Image', description: 'desc', numCustomNodes: 3, version: '2', state: 'installable' })
    // The latest complete version (2) is the one resolved, not version 1.
    expect(client.getVersion).toHaveBeenCalledWith('v2')
  })

  it('marks no-build when no version has a completed status', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'Pending' }],
      versionsByDist: { d1: [version(1, 'building'), version(2, 'failed')] },
    })
    const rows = await listDistributionRows(client as never, HOST)
    const row = rows[0]!
    expect(row).toMatchObject({ state: 'no-build', blockedReason: 'buildFailed' })
    expect(row.version).toBeUndefined()
  })

  it('marks platform-mismatch when the latest complete version has no host artifact', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'WinOnly' }],
      versionsByDist: { d1: [version(3, 'complete')] },
      artifactsByVersion: { v3: [artifact({ os: 'windows' })] },
    })
    const rows = await listDistributionRows(client as never, HOST)
    const row = rows[0]!
    expect(row).toMatchObject({ version: '3', state: 'platform-mismatch', blockedReason: 'noArtifactForMachine' })
    expect(row.targetOs).toEqual(['windows'])
  })

  it('reports every OS a mismatched build targets, deduped and sorted', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'NotForLinux' }],
      versionsByDist: { d1: [version(3, 'complete')] },
      artifactsByVersion: {
        v3: [
          artifact({ os: 'windows', gpu: 'nvidia' }),
          artifact({ os: 'mac' }),
          // Same OS twice must not double up, and a half-built target isn't
          // somewhere you could actually run it.
          artifact({ os: 'windows', gpu: 'cpu' }),
          artifact({ os: 'linux', status: 'building' }),
        ],
      },
    })
    const rows = await listDistributionRows(client as never, HOST)
    expect(rows[0]!.targetOs).toEqual(['mac', 'windows'])
  })

  it('marks update-available when installed older and the newer build runs here', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'Image' }],
      versionsByDist: { d1: [version(1, 'complete'), version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] },
    })
    const rows = await listDistributionRows(client as never, HOST, new Map([['d1', 1]]))
    expect(rows[0]).toMatchObject({ version: '2', installedVersion: 1, state: 'update-available' })
  })

  it('stays installable (not update-available) when installed at the latest version', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'Image' }],
      versionsByDist: { d1: [version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] },
    })
    const rows = await listDistributionRows(client as never, HOST, new Map([['d1', 2]]))
    expect(rows[0]).toMatchObject({ version: '2', installedVersion: 2, state: 'installable' })
  })

  it('does NOT offer an update when the newer version has no host artifact', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'WinOnly' }],
      versionsByDist: { d1: [version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact({ os: 'windows' })] }, // no linux/nvidia build
    })
    const rows = await listDistributionRows(client as never, HOST, new Map([['d1', 1]]))
    expect(rows[0]).toMatchObject({ state: 'platform-mismatch' })
    expect(rows[0]!.state).not.toBe('update-available')
  })

  it('leaves installedVersion unset for a distribution that is not installed', async () => {
    const client = stubClient({
      distributions: [{ id: 'd1', name: 'Image' }],
      versionsByDist: { d1: [version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] },
    })
    const rows = await listDistributionRows(client as never, HOST, new Map())
    expect(rows[0]!.installedVersion).toBeUndefined()
    expect(rows[0]!.state).toBe('installable')
  })

  it('drops a distribution whose version lookup fails without failing the whole grid', async () => {
    const client = stubClient({
      distributions: [{ id: 'ok', name: 'Ok' }, { id: 'bad', name: 'Bad' }],
      versionsByDist: { ok: [version(1, 'complete')] },
      artifactsByVersion: { v1: [artifact()] },
    })
    client.listVersions.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('boom')
      return [version(1, 'complete')]
    })
    const rows = await listDistributionRows(client as never, HOST)
    expect(rows.map((r) => r.id)).toEqual(['ok'])
  })
})

describe('resolveHostArtifact', () => {
  it('returns the host artifact of the latest complete version', async () => {
    const client = stubClient({
      versionsByDist: { d1: [version(5, 'complete'), version(4, 'complete')] },
      artifactsByVersion: { v5: [artifact({ id: 'pick-me' })] },
    })
    const resolved = await resolveHostArtifact(client as never, HOST, 'd1')
    expect(resolved).toMatchObject({ version: 5, artifact: { id: 'pick-me' } })
  })

  it('returns null when there is no complete version', async () => {
    const client = stubClient({ versionsByDist: { d1: [version(1, 'building')] } })
    expect(await resolveHostArtifact(client as never, HOST, 'd1')).toBeNull()
  })

  it('returns null when the complete version has no host artifact', async () => {
    const client = stubClient({
      versionsByDist: { d1: [version(1, 'complete')] },
      artifactsByVersion: { v1: [artifact({ os: 'mac', gpu: 'mps' })] },
    })
    expect(await resolveHostArtifact(client as never, HOST, 'd1')).toBeNull()
  })
})
