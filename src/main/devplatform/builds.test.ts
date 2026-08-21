// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listCompleteVersions,
  listBuildRows,
  resolveHostArtifact,
  resolveHostArtifactForVersion
} from './builds'
import { clearVersionCache, getCachedVersions } from './versionCache'
import type { Artifact, Build, BuildVersion, Host } from '../comfybuilder'

const HOST: Host = { os: 'linux', gpu: 'nvidia' }

beforeEach(() => clearVersionCache())

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art-1',
    os: 'linux',
    gpu: 'nvidia',
    accelVariant: 'cu128',
    status: 'ready',
    archiveSha256: 'abc',
    ...overrides
  }
}

function version(v: number, status: string): BuildVersion {
  return { id: `v${v}`, version: v, status, createdAt: '2026-07-20T00:00:00Z' }
}

/** A stub client whose wire catalog and per-version data are table-driven. */
function stubClient(opts: {
  builds?: Build[]
  versionsByBuild?: Record<string, BuildVersion[]>
  artifactsByVersion?: Record<string, Artifact[]>
}) {
  return {
    listBuilds: vi.fn(async () => opts.builds ?? []),
    listVersions: vi.fn(async (id: string) => opts.versionsByBuild?.[id] ?? []),
    getVersion: vi.fn(async (id: string) => ({
      version: Number(id.replace('v', '')),
      artifacts: opts.artifactsByVersion?.[id] ?? []
    }))
  }
}

describe('listBuildRows', () => {
  it('marks a build installable when the latest complete version has a host artifact', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'Image', description: 'desc', numCustomNodes: 3 }],
      versionsByBuild: { d1: [version(1, 'complete'), version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] }
    })
    const rows = await listBuildRows(client as never, HOST)
    const row = rows[0]!
    expect(row).toMatchObject({
      id: 'd1',
      name: 'Image',
      description: 'desc',
      numCustomNodes: 3,
      version: '2',
      state: 'installable'
    })
    // The latest complete version (2) is the one resolved, not version 1.
    expect(client.getVersion).toHaveBeenCalledWith('v2')
  })

  it('marks no-build when no version has a completed status', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'Pending' }],
      versionsByBuild: { d1: [version(1, 'building'), version(2, 'queued')] }
    })
    const rows = await listBuildRows(client as never, HOST)
    const row = rows[0]!
    expect(row).toMatchObject({ state: 'no-build', blockedReason: 'buildInProgress' })
    expect(row.version).toBeUndefined()
  })

  it('marks an empty version list as build failed', async () => {
    const client = stubClient({ builds: [{ id: 'd1', name: 'Empty' }] })
    const rows = await listBuildRows(client as never, HOST)
    expect(rows[0]).toMatchObject({ state: 'no-build', blockedReason: 'buildFailed' })
  })

  it('limits row resolution concurrency and preserves build order', async () => {
    const builds = Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, name: `Build ${i}` }))
    const client = stubClient({ builds })
    let current = 0
    let maximum = 0
    client.listVersions.mockImplementation(async () => {
      current++
      maximum = Math.max(maximum, current)
      await new Promise<void>((resolve) => setImmediate(resolve))
      current--
      return []
    })

    const rows = await listBuildRows(client as never, HOST)
    expect(maximum).toBe(6)
    expect(rows.map((row) => row.id)).toEqual(builds.map((build) => build.id))
  })

  it('marks platform-mismatch when the latest complete version has no host artifact', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'WinOnly' }],
      versionsByBuild: { d1: [version(3, 'complete')] },
      artifactsByVersion: { v3: [artifact({ os: 'windows' })] }
    })
    const rows = await listBuildRows(client as never, HOST)
    const row = rows[0]!
    expect(row).toMatchObject({
      version: '3',
      state: 'platform-mismatch',
      blockedReason: 'noArtifactForMachine'
    })
    expect(row.targetOs).toEqual(['windows'])
  })

  it('reports every OS a mismatched build targets, deduped and sorted', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'NotForLinux' }],
      versionsByBuild: { d1: [version(3, 'complete')] },
      artifactsByVersion: {
        v3: [
          artifact({ os: 'windows', gpu: 'nvidia' }),
          artifact({ os: 'mac' }),
          // Same OS twice must not double up, and a half-built target isn't
          // somewhere you could actually run it.
          artifact({ os: 'windows', gpu: 'cpu' }),
          artifact({ os: 'linux', status: 'building' })
        ]
      }
    })
    const rows = await listBuildRows(client as never, HOST)
    expect(rows[0]!.targetOs).toEqual(['mac', 'windows'])
  })

  it('marks update-available when installed older and the newer build runs here', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'Image' }],
      versionsByBuild: { d1: [version(1, 'complete'), version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] }
    })
    const rows = await listBuildRows(client as never, HOST, new Map([['d1', 1]]))
    expect(rows[0]).toMatchObject({ version: '2', installedVersion: 1, state: 'update-available' })
  })

  it('stays installable (not update-available) when installed at the latest version', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'Image' }],
      versionsByBuild: { d1: [version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] }
    })
    const rows = await listBuildRows(client as never, HOST, new Map([['d1', 2]]))
    expect(rows[0]).toMatchObject({ version: '2', installedVersion: 2, state: 'installable' })
  })

  it('does NOT offer an update when the newer version has no host artifact', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'WinOnly' }],
      versionsByBuild: { d1: [version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact({ os: 'windows' })] } // no linux/nvidia build
    })
    const rows = await listBuildRows(client as never, HOST, new Map([['d1', 1]]))
    expect(rows[0]).toMatchObject({ state: 'platform-mismatch' })
    expect(rows[0]!.state).not.toBe('update-available')
  })

  it('leaves installedVersion unset for a build that is not installed', async () => {
    const client = stubClient({
      builds: [{ id: 'd1', name: 'Image' }],
      versionsByBuild: { d1: [version(2, 'complete')] },
      artifactsByVersion: { v2: [artifact()] }
    })
    const rows = await listBuildRows(client as never, HOST, new Map())
    expect(rows[0]!.installedVersion).toBeUndefined()
    expect(rows[0]!.state).toBe('installable')
  })

  it('drops a build whose version lookup fails without failing the whole grid', async () => {
    const client = stubClient({
      builds: [
        { id: 'first', name: 'First' },
        { id: 'bad', name: 'Bad' },
        { id: 'last', name: 'Last' }
      ],
      versionsByBuild: { ok: [version(1, 'complete')] },
      artifactsByVersion: { v1: [artifact()] }
    })
    client.listVersions.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('boom')
      return [version(1, 'complete')]
    })
    const rows = await listBuildRows(client as never, HOST)
    expect(rows.map((r) => r.id)).toEqual(['first', 'last'])
  })
})

describe('listCompleteVersions', () => {
  it('returns complete versions newest first, dropping unbuilt ones', async () => {
    const client = stubClient({
      versionsByBuild: {
        d1: [
          version(2, 'complete'),
          version(5, 'complete'),
          version(6, 'building'),
          version(1, 'failed')
        ]
      }
    })
    expect(await listCompleteVersions(client as never, 'd1')).toEqual([5, 2])
  })
})

describe('version cache warming', () => {
  it("caches a build's complete versions as a side effect of listing rows", async () => {
    // The manage view builds its Update tab synchronously and cannot fetch, so
    // the catalog read the chooser already does is what fills it.
    const client = stubClient({
      builds: [{ id: 'd1', name: 'Image' }],
      versionsByBuild: {
        d1: [version(1, 'complete'), version(3, 'complete'), version(4, 'building')]
      },
      artifactsByVersion: { v3: [artifact()] }
    })
    await listBuildRows(client as never, HOST)
    expect(getCachedVersions('d1')?.versions).toEqual([3, 1])
  })
})

describe('resolveHostArtifact', () => {
  it('returns the host artifact of the latest complete version', async () => {
    const client = stubClient({
      versionsByBuild: { d1: [version(5, 'complete'), version(4, 'complete')] },
      artifactsByVersion: { v5: [artifact({ id: 'pick-me' })] }
    })
    const resolved = await resolveHostArtifact(client as never, HOST, 'd1')
    expect(resolved).toMatchObject({ version: 5, artifact: { id: 'pick-me' } })
  })

  it('returns null when there is no complete version', async () => {
    const client = stubClient({ versionsByBuild: { d1: [version(1, 'building')] } })
    expect(await resolveHostArtifact(client as never, HOST, 'd1')).toBeNull()
  })

  it('returns null when the complete version has no host artifact', async () => {
    const client = stubClient({
      versionsByBuild: { d1: [version(1, 'complete')] },
      artifactsByVersion: { v1: [artifact({ os: 'mac', gpu: 'mps' })] }
    })
    expect(await resolveHostArtifact(client as never, HOST, 'd1')).toBeNull()
  })
})

describe('resolveHostArtifactForVersion', () => {
  it('resolves the named version, not just the latest', async () => {
    const client = stubClient({
      versionsByBuild: { d1: [version(9, 'complete'), version(5, 'complete')] },
      artifactsByVersion: { v5: [artifact({ id: 'older-pick' })], v9: [artifact({ id: 'newer' })] }
    })
    const resolved = await resolveHostArtifactForVersion(client as never, HOST, 'd1', 5)
    expect(resolved).toMatchObject({ version: 5, artifact: { id: 'older-pick' } })
  })

  it('returns null when the named version is not published', async () => {
    const client = stubClient({ versionsByBuild: { d1: [version(9, 'complete')] } })
    expect(await resolveHostArtifactForVersion(client as never, HOST, 'd1', 5)).toBeNull()
  })

  it('returns null when the named version is not complete', async () => {
    const client = stubClient({
      versionsByBuild: { d1: [version(5, 'building')] },
      artifactsByVersion: { v5: [artifact()] }
    })
    expect(await resolveHostArtifactForVersion(client as never, HOST, 'd1', 5)).toBeNull()
  })

  it('returns null when the named version has no artifact for this host', async () => {
    const client = stubClient({
      versionsByBuild: { d1: [version(5, 'complete')] },
      artifactsByVersion: { v5: [artifact({ os: 'mac', gpu: 'mps' })] }
    })
    expect(await resolveHostArtifactForVersion(client as never, HOST, 'd1', 5)).toBeNull()
  })
})
