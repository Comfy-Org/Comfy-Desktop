// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { compatibleArtifactsForHost, hostOs, selectArtifactForHost } from './targets'
import type { Artifact, Host } from './types'

function art(o: Artifact['os'], g: Artifact['gpu'], overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `${o}-${g}`,
    os: o,
    gpu: g,
    accelVariant: g === 'nvidia' ? 'cu128' : g,
    status: 'ready',
    ...overrides
  }
}

const catalog: Artifact[] = [
  art('linux', 'cpu'),
  art('linux', 'nvidia'),
  art('windows', 'cpu'),
  art('windows', 'nvidia')
]

describe('hostOs', () => {
  it('maps process.platform to a build-target os', () => {
    const expected =
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
    expect(hostOs()).toBe(expected)
  })
})

describe('selectArtifactForHost', () => {
  it.each<[string, Host, string | null]>([
    ['exact os+gpu (windows/nvidia)', { os: 'windows', gpu: 'nvidia' }, 'windows-nvidia'],
    ['cpu fallback (windows host, cpu gpu)', { os: 'windows', gpu: 'cpu' }, 'windows-cpu'],
    ['os filter rejects a mac nvidia host', { os: 'mac', gpu: 'nvidia' }, null],
    ['no artifact for the host os (mac)', { os: 'mac', gpu: 'mps' }, null],
    ['linux nvidia', { os: 'linux', gpu: 'nvidia' }, 'linux-nvidia']
  ])('%s', (_name, host, expectedId) => {
    expect(selectArtifactForHost(catalog, host)?.id ?? null).toBe(expectedId)
  })

  it('prefers exact gpu over the cpu fallback', () => {
    const both = [art('linux', 'cpu'), art('linux', 'nvidia')]
    expect(selectArtifactForHost(both, { os: 'linux', gpu: 'nvidia' })?.gpu).toBe('nvidia')
  })

  it('ignores non-ready artifacts', () => {
    const notReady = [art('linux', 'nvidia', { status: 'building' })]
    expect(selectArtifactForHost(notReady, { os: 'linux', gpu: 'nvidia' })).toBeNull()
  })

  it('an nvidia host still installs a cpu-only build', () => {
    const cpuOnly = [art('windows', 'cpu')]
    expect(selectArtifactForHost(cpuOnly, { os: 'windows', gpu: 'nvidia' })?.gpu).toBe('cpu')
  })

  it('prefers the matching accelVariant among same-gpu builds', () => {
    const cudas = [
      art('linux', 'nvidia', { id: 'cu118', accelVariant: 'cu118' }),
      art('linux', 'nvidia', { id: 'cu128', accelVariant: 'cu128' })
    ]
    expect(
      selectArtifactForHost(cudas, { os: 'linux', gpu: 'nvidia', accelVariant: 'cu128' })?.id
    ).toBe('cu128')
  })

  it('is deterministic (not input-order dependent) when accel ties', () => {
    const a = art('linux', 'nvidia', { id: 'cu118', accelVariant: 'cu118' })
    const b = art('linux', 'nvidia', { id: 'cu128', accelVariant: 'cu128' })
    const host = { os: 'linux', gpu: 'nvidia' } as const
    expect(selectArtifactForHost([a, b], host)?.id).toBe('cu128')
    expect(selectArtifactForHost([b, a], host)?.id).toBe('cu128')
  })
})

describe('compatibleArtifactsForHost', () => {
  it('returns exact GPU targets before CPU fallbacks', () => {
    const targets = [
      art('windows', 'cpu', { id: 'cpu' }),
      art('windows', 'nvidia', { id: 'cuda-118', accelVariant: 'cu118' }),
      art('windows', 'nvidia', { id: 'cuda-128', accelVariant: 'cu128' })
    ]

    expect(
      compatibleArtifactsForHost(targets, { os: 'windows', gpu: 'nvidia' }).map(
        (artifact) => artifact.id
      )
    ).toEqual(['cuda-128', 'cuda-118', 'cpu'])
  })

  it('excludes wrong-OS, incompatible-GPU, and unfinished targets', () => {
    const targets = [
      art('windows', 'nvidia', { id: 'ready' }),
      art('linux', 'nvidia', { id: 'wrong-os' }),
      art('windows', 'amd', { id: 'wrong-gpu' }),
      art('windows', 'cpu', { id: 'building', status: 'building' })
    ]

    expect(
      compatibleArtifactsForHost(targets, { os: 'windows', gpu: 'nvidia' }).map(
        (artifact) => artifact.id
      )
    ).toEqual(['ready'])
  })
})
