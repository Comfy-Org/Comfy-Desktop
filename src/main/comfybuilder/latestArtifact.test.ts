// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Artifact, Deployment } from './dto'
import { pipelineInstallState, resolveLatestArtifact } from './latestArtifact'

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    artifact_id: 'artifact-1',
    filename: 'dist.tar.gz',
    download_url: '/api/v1/pipelines/p1/deployments/d1/artifact',
    checksum: 'sha256:abc',
    size_bytes: 1024,
    ...overrides
  }
}

function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 'dep-1',
    pipeline_id: 'p1',
    pipeline_revision: 1,
    version: 'v1.0.0',
    status: 'succeeded',
    finished_at: '2024-01-01T00:00:00Z',
    artifact: makeArtifact(),
    ...overrides
  }
}

describe('comfybuilder install resolver', () => {
  it('picks the newest succeeded build with an artifact, ignoring newer failures', () => {
    const deployments: Deployment[] = [
      makeDeployment({
        id: 'dep-jan',
        finished_at: '2024-01-01T00:00:00Z',
        artifact: makeArtifact({ artifact_id: 'art-jan' })
      }),
      makeDeployment({
        id: 'dep-jun',
        status: 'failed',
        finished_at: '2024-06-01T00:00:00Z',
        artifact: null
      }),
      makeDeployment({
        id: 'dep-mar',
        finished_at: '2024-03-01T00:00:00Z',
        artifact: makeArtifact({ artifact_id: 'art-mar' })
      })
    ]

    const result = resolveLatestArtifact(deployments)

    expect(result).not.toBeNull()
    expect(result?.deployment.id).toBe('dep-mar')
    expect(result?.deployment.finished_at).toBe('2024-03-01T00:00:00Z')
    expect(result?.deployment.status).toBe('succeeded')
    expect(result?.artifact.artifact_id).toBe('art-mar')

    // The newest overall build (dep-jun) FAILED, so it never wins.
    expect(pipelineInstallState(deployments)).toEqual({ installable: true })
  })

  it('treats a partial build with an artifact as installable and downloadable', () => {
    const deployments: Deployment[] = [
      makeDeployment({
        id: 'dep-partial',
        status: 'partial',
        finished_at: '2024-07-01T00:00:00Z',
        artifact: makeArtifact({ artifact_id: 'art-partial' }),
        target_statuses: [
          { target_id: 'linux-nvidia-targz', status: 'succeeded' },
          { target_id: 'win-nvidia-zip', status: 'failed', error: 'toolchain missing' }
        ]
      })
    ]

    // No per-target artifact present -> legacy deployment-level artifact.
    const result = resolveLatestArtifact(deployments)
    expect(result?.deployment.id).toBe('dep-partial')
    expect(result?.deployment.status).toBe('partial')
    expect(result?.artifact.artifact_id).toBe('art-partial')
    expect(result?.targetId).toBe('')
    expect(pipelineInstallState(deployments)).toEqual({ installable: true })
  })

  it('ignores a partial build with no artifact', () => {
    const deployments: Deployment[] = [
      makeDeployment({ id: 'dep-partial-empty', status: 'partial', artifact: null })
    ]

    expect(resolveLatestArtifact(deployments)).toBeNull()
    expect(pipelineInstallState(deployments)).toEqual({
      installable: false,
      reason: 'no-successful-build'
    })
  })

  it('returns null and reports no-successful-build when nothing succeeded with an artifact', () => {
    const deployments: Deployment[] = [
      makeDeployment({ id: 'dep-failed', status: 'failed', artifact: null }),
      makeDeployment({ id: 'dep-building', status: 'building', artifact: null }),
      // A succeeded deployment WITHOUT an artifact does not qualify.
      makeDeployment({ id: 'dep-no-artifact', status: 'succeeded', artifact: null })
    ]

    expect(resolveLatestArtifact(deployments)).toBeNull()
    expect(pipelineInstallState(deployments)).toEqual({
      installable: false,
      reason: 'no-successful-build'
    })
  })

  it('tie-breaks by id and sorts a null finished_at last (treated as oldest)', () => {
    const deployments: Deployment[] = [
      makeDeployment({
        id: 'dep-aaa',
        finished_at: '2024-05-01T00:00:00Z',
        artifact: makeArtifact({ artifact_id: 'art-aaa' })
      }),
      makeDeployment({
        id: 'dep-zzz',
        finished_at: '2024-05-01T00:00:00Z',
        artifact: makeArtifact({ artifact_id: 'art-zzz' })
      }),
      makeDeployment({
        id: 'dep-null',
        finished_at: null,
        artifact: makeArtifact({ artifact_id: 'art-null' })
      })
    ]

    // Equal finished_at -> higher id wins the tie-break; null finished_at is oldest.
    expect(resolveLatestArtifact(deployments)?.deployment.id).toBe('dep-zzz')

    // Reversing the input must not change the winner (determinism).
    const reversed = resolveLatestArtifact([...deployments].reverse())
    expect(reversed?.deployment.id).toBe('dep-zzz')
  })

  it('treats a malformed finished_at as oldest', () => {
    const deployments: Deployment[] = [
      makeDeployment({
        id: 'dep-good',
        finished_at: '2024-02-01T00:00:00Z',
        artifact: makeArtifact({ artifact_id: 'art-good' })
      }),
      makeDeployment({
        id: 'dep-bad',
        finished_at: 'not-a-real-date',
        artifact: makeArtifact({ artifact_id: 'art-bad' })
      })
    ]

    expect(resolveLatestArtifact(deployments)?.deployment.id).toBe('dep-good')
  })

  it('blocks a per-target build whose targets do not match the host platform', () => {
    const linuxOnly = makeDeployment({
      id: 'dep-linux',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-linux' }),
      target_statuses: [
        {
          target_id: 'linux-nvidia-targz',
          status: 'succeeded',
          artifact: makeArtifact({ artifact_id: 'art-linux-nvidia' })
        }
      ]
    })

    // A Windows host has no matching target in a linux-only build.
    expect(pipelineInstallState([linuxOnly], 'win32')).toEqual({
      installable: false,
      reason: 'platform-mismatch'
    })
    expect(resolveLatestArtifact([linuxOnly], 'win32')).toBeNull()

    // A Linux host matches and installs the linux target's own artifact.
    expect(pipelineInstallState([linuxOnly], 'linux-x64')).toEqual({ installable: true })
    const linuxPick = resolveLatestArtifact([linuxOnly], 'linux-x64')
    expect(linuxPick?.artifact.artifact_id).toBe('art-linux-nvidia')
    expect(linuxPick?.targetId).toBe('linux-nvidia-targz')
  })

  it('selects the host-matching target artifact when all four targets succeed', () => {
    const allTargets = makeDeployment({
      id: 'dep-all',
      finished_at: '2024-04-01T00:00:00Z',
      // Legacy field points at whichever target built first (linux here); it
      // must NOT be what a Windows host installs.
      artifact: makeArtifact({ artifact_id: 'art-legacy-linux' }),
      target_statuses: [
        {
          target_id: 'linux-cpu-targz',
          status: 'succeeded',
          artifact: makeArtifact({ artifact_id: 'art-linux-cpu' })
        },
        {
          target_id: 'linux-nvidia-targz',
          status: 'succeeded',
          artifact: makeArtifact({ artifact_id: 'art-linux-nvidia' })
        },
        {
          target_id: 'windows-cpu-targz',
          status: 'succeeded',
          artifact: makeArtifact({ artifact_id: 'art-windows-cpu' })
        },
        {
          target_id: 'windows-nvidia-targz',
          status: 'succeeded',
          artifact: makeArtifact({ artifact_id: 'art-windows-nvidia' })
        }
      ]
    })

    // Windows host -> a windows target, preferring the CPU archive.
    const win = resolveLatestArtifact([allTargets], 'win32')
    expect(win?.targetId).toBe('windows-cpu-targz')
    expect(win?.artifact.artifact_id).toBe('art-windows-cpu')

    // Linux host -> a linux target, preferring the CPU archive.
    const linux = resolveLatestArtifact([allTargets], 'linux')
    expect(linux?.targetId).toBe('linux-cpu-targz')
    expect(linux?.artifact.artifact_id).toBe('art-linux-cpu')

    expect(pipelineInstallState([allTargets], 'win32')).toEqual({ installable: true })
  })

  it('prefers the only matching GPU target when no CPU target exists', () => {
    const gpuOnly = makeDeployment({
      id: 'dep-gpu',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-legacy' }),
      target_statuses: [
        {
          target_id: 'windows-nvidia-targz',
          status: 'succeeded',
          artifact: makeArtifact({ artifact_id: 'art-windows-nvidia' })
        }
      ]
    })

    const win = resolveLatestArtifact([gpuOnly], 'win32')
    expect(win?.targetId).toBe('windows-nvidia-targz')
    expect(win?.artifact.artifact_id).toBe('art-windows-nvidia')
  })

  it('falls back to the legacy artifact for a build with no per-target artifacts', () => {
    // target_statuses present but WITHOUT per-target artifacts = old backend.
    const legacy = makeDeployment({
      id: 'dep-legacy',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-legacy' }),
      target_statuses: [{ target_id: 'linux-nvidia-targz', status: 'succeeded' }]
    })

    // Legacy builds are installable regardless of host and use the single artifact.
    const pick = resolveLatestArtifact([legacy], 'win32')
    expect(pick?.artifact.artifact_id).toBe('art-legacy')
    expect(pick?.targetId).toBe('')
    expect(pipelineInstallState([legacy], 'win32')).toEqual({ installable: true })

    // With no target metadata at all, likewise installable and legacy.
    const bare = makeDeployment({
      id: 'dep-bare',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-bare' })
    })
    expect(pipelineInstallState([bare], 'win32')).toEqual({ installable: true })
    expect(resolveLatestArtifact([bare], 'win32')?.targetId).toBe('')
  })
})
