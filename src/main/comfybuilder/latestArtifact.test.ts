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

    const result = resolveLatestArtifact(deployments)
    expect(result?.deployment.id).toBe('dep-partial')
    expect(result?.deployment.status).toBe('partial')
    expect(result?.artifact.artifact_id).toBe('art-partial')
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

  it('blocks on a best-effort platform mismatch and allows a matching platform', () => {
    const linuxDeployment = makeDeployment({
      id: 'dep-linux',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-linux' }),
      target_statuses: [{ target_id: 'linux-nvidia-targz', status: 'succeeded' }]
    })

    // A platform sharing no token with the build target is blocked.
    expect(pipelineInstallState([linuxDeployment], 'win32')).toEqual({
      installable: false,
      reason: 'platform-mismatch'
    })

    // A platform sharing the `linux` token installs.
    expect(pipelineInstallState([linuxDeployment], 'linux-x64')).toEqual({ installable: true })

    // Node's `win32` maps to the `windows` build-target token and installs.
    const windowsDeployment = makeDeployment({
      id: 'dep-windows',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-windows' }),
      target_statuses: [{ target_id: 'windows-nvidia-targz', status: 'succeeded' }]
    })
    expect(pipelineInstallState([windowsDeployment], 'win32')).toEqual({ installable: true })

    // Node's `darwin` maps to the `macos` build-target token and installs.
    const macDeployment = makeDeployment({
      id: 'dep-macos',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-macos' }),
      target_statuses: [{ target_id: 'macos-nvidia-targz', status: 'succeeded' }]
    })
    expect(pipelineInstallState([macDeployment], 'darwin')).toEqual({ installable: true })

    // A Windows host is still blocked from a linux-only build.
    expect(pipelineInstallState([linuxDeployment], 'win32')).toEqual({
      installable: false,
      reason: 'platform-mismatch'
    })

    // With no platform metadata, the platform check is best-effort and never blocks.
    const bareDeployment = makeDeployment({
      id: 'dep-bare',
      finished_at: '2024-04-01T00:00:00Z',
      artifact: makeArtifact({ artifact_id: 'art-bare' })
    })
    expect(pipelineInstallState([bareDeployment], 'win32')).toEqual({ installable: true })
  })
})
