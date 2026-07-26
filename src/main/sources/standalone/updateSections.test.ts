import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import type { InstallationRecord } from '../../installations'
import type * as I18nModule from '../../lib/i18n'

// `getDetailSections` transitively imports `electron` (via paths/settings).
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
}))

/**
 * Locks the `update-comfyui` action-payload's downgrade-vs-update branch. The
 * function reads the FS (.git probe) and release-cache, both mocked. `t()`
 * returns the bare i18n key (no locale), so we assert against the key.
 */

vi.mock('../../lib/release-cache', () => ({
  getEffectiveInfo: vi.fn(),
  isUpdateAvailable: vi.fn(() => true),
}))
vi.mock('../../lib/git', () => ({
  hasGitDir: vi.fn(() => true),
}))
vi.mock('./torchStackCatalog', () => ({
  getCachedTorchStacks: vi.fn(() => []),
}))
// No locale is loaded in tests, so the real t() returns the bare key — the
// same signal production uses for "unknown key". Translate exactly one note
// key so the known-noteKey path is exercisable too.
vi.mock('../../lib/i18n', async (importOriginal) => {
  const mod = await importOriginal<typeof I18nModule>()
  return {
    ...mod,
    t: (key: string, params?: Record<string, string | number>) =>
      key === 'standalone.pytorchIndexNoteCu128' ? 'Requires CUDA 12.8 drivers' : mod.t(key, params),
  }
})

import * as releaseCache from '../../lib/release-cache'
import { getCachedTorchStacks } from './torchStackCatalog'
import type { TorchStackEntry } from './torchStackCatalog'
import { getDetailSections, getEffectiveChannel } from './updateSections'

interface UpdateAction {
  id: string
  progressTitle: string
  data?: { channel?: string; isDowngrade?: boolean; stackId?: string }
  confirm?: { title?: string; message?: string }
  prompt?: { defaultValue?: string; uniquifyDefault?: boolean }
}
interface ChannelOption {
  value: string
  data?: { actions?: UpdateAction[] }
}
interface UpdateField { id: string; options: ChannelOption[] }
interface UpdateSection { tab: string; fields?: UpdateField[] }

function getChannelAction(installation: InstallationRecord, channel: 'stable' | 'latest', actionId: string): UpdateAction | undefined {
  const sections = getDetailSections(installation) as unknown as UpdateSection[]
  const updates = sections.find((s) => s.tab === 'update')
  const channelField = updates?.fields?.find((f) => f.id === 'updateChannel')
  const option = channelField?.options?.find((o) => o.value === channel)
  return option?.data?.actions?.find((a) => a.id === actionId)
}

function getUpdateAction(installation: InstallationRecord, channel: 'stable' | 'latest'): UpdateAction | undefined {
  return getChannelAction(installation, channel, 'update-comfyui')
}

function baseInstall(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'Test Install',
    sourceId: 'standalone',
    installPath: '/tmp/test-install',
    status: 'installed',
    createdAt: Date.now(),
    updateChannel: 'stable',
    comfyVersion: { commit: 'abc1234', baseTag: 'v0.3.20', commitsAhead: 0 },
    ...overrides,
  } as InstallationRecord
}

describe('updateSections — update-comfyui action payload', () => {
  beforeEach(() => {
    vi.mocked(releaseCache.getEffectiveInfo).mockReset()
    vi.mocked(releaseCache.isUpdateAvailable).mockReset().mockReturnValue(true)
    // hasGit is gated on a `.git` probe; return true so the actions are emitted.
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(releaseCache.getEffectiveInfo).mockImplementation((_repo, channel) => ({
      installedTag: 'v0.3.20',
      commitSha: 'def5678cafebabe',
      baseTag: 'v0.3.20',
      commitsAhead: channel === 'latest' ? 12 : 0,
      latestTag: channel === 'latest' ? 'def5678' : 'v0.3.20',
      releaseName: channel === 'latest' ? 'v0.3.20+12' : 'v0.3.20',
      checkedAt: Date.now(),
    }))
  })

  it('frames a stable target as a channel switch (not a downgrade) when the install is effectively on latest', () => {
    // commitsAhead > 0 makes getEffectiveChannel report `latest`, so picking the
    // `stable` card is a channel switch.
    const action = getUpdateAction(
      baseInstall({ comfyVersion: { commit: 'abc1234', baseTag: 'v0.3.20', commitsAhead: 5 } } as Partial<InstallationRecord>),
      'stable'
    )
    expect(action).toBeDefined()
    // Backend still rolls back, but the copy is "Switching to", not "Downgrading".
    expect(action!.data?.isDowngrade).toBe(true)
    expect(action!.progressTitle).toBe('channelCards.switchingToTitle')
  })

  it('flags isDowngrade=true when commitsAhead is undefined but baseTag exists (older snapshot/install)', () => {
    const action = getUpdateAction(
      baseInstall({ comfyVersion: { commit: 'abc1234', baseTag: 'v0.3.20', commitsAhead: undefined } } as Partial<InstallationRecord>),
      'stable'
    )
    expect(action!.data?.isDowngrade).toBe(true)
    expect(action!.progressTitle).toBe('standalone.downgradingTitle')
  })

  it('flags isDowngrade=false when install is exactly on stable (commitsAhead=0)', () => {
    const action = getUpdateAction(
      baseInstall({ comfyVersion: { commit: 'abc1234', baseTag: 'v0.3.20', commitsAhead: 0 } } as Partial<InstallationRecord>),
      'stable'
    )
    expect(action!.data?.isDowngrade).toBe(false)
    expect(action!.progressTitle).toBe('standalone.updatingTitle')
  })

  it('flags isDowngrade=false when baseTag is missing (no anchor — can\'t tell direction)', () => {
    const action = getUpdateAction(
      baseInstall({ comfyVersion: { commit: 'abc1234', baseTag: undefined as unknown as string, commitsAhead: undefined } } as Partial<InstallationRecord>),
      'stable'
    )
    expect(action!.data?.isDowngrade).toBe(false)
    expect(action!.progressTitle).toBe('standalone.updatingTitle')
  })

  it('never flags isDowngrade on `latest` channel target — moving to master tip is always forward', () => {
    const action = getUpdateAction(
      baseInstall({ comfyVersion: { commit: 'abc1234', baseTag: 'v0.3.20', commitsAhead: 5 } } as Partial<InstallationRecord>),
      'latest'
    )
    expect(action!.data?.isDowngrade).toBe(false)
    expect(action!.progressTitle).toBe('standalone.updatingTitle')
  })

  it('still carries actionData.channel when switching channels (regression guard for lifecycle:705)', () => {
    const action = getUpdateAction(baseInstall({ updateChannel: 'stable' }), 'latest')
    expect(action!.data?.channel).toBe('latest')
    expect(action!.data?.isDowngrade).toBe(false)
  })

  it('always carries actionData.channel, even on a same-channel update', () => {
    // The explicit target channel must be carried so the handler never falls back
    // to a stale stored `updateChannel`.
    const action = getUpdateAction(baseInstall({ updateChannel: 'stable' }), 'stable')
    expect(action!.data?.channel).toBe('stable')
    expect(action!.data?.isDowngrade).toBeDefined()
  })

  it('confirm copy carries the breakage warning and the snapshot-undo hint', () => {
    // The update is reversible via the auto-saved pre-update snapshot; the
    // confirm copy must surface both the risk and the undo path.
    const action = getUpdateAction(baseInstall({ updateChannel: 'stable' }), 'stable')
    expect(action!.confirm?.message).toContain('standalone.updateBreakingWarning')
    expect(action!.confirm?.message).toContain('standalone.updateSnapshotUndoHint')
  })
})

describe('getEffectiveChannel — de-facto channel from git state', () => {
  it('returns the stored channel when the install sits exactly on its base tag', () => {
    expect(getEffectiveChannel(baseInstall({
      updateChannel: 'stable',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.3.20', commitsAhead: 0 },
    } as Partial<InstallationRecord>))).toBe('stable')
  })

  it('reports `latest` for a stored-`stable` install whose checkout is ahead of its base tag', () => {
    // e.g. a `git pull` outside the app leaves updateChannel stale on `stable`.
    expect(getEffectiveChannel(baseInstall({
      updateChannel: 'stable',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.22.3', commitsAhead: 59 },
    } as Partial<InstallationRecord>))).toBe('latest')
  })

  it('does not infer when commitsAhead is unknown (avoids flicker before enrichment)', () => {
    expect(getEffectiveChannel(baseInstall({
      updateChannel: 'stable',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.22.3', commitsAhead: undefined },
    } as Partial<InstallationRecord>))).toBe('stable')
  })

  it('never overrides an explicit non-stable stored channel', () => {
    expect(getEffectiveChannel(baseInstall({
      updateChannel: 'latest',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.22.3', commitsAhead: 0 },
    } as Partial<InstallationRecord>))).toBe('latest')
  })
})

describe('updateSections — channel picker reflects de-facto channel', () => {
  it('marks the latest card current when a stored-stable install is ahead of its base tag', () => {
    const sections = getDetailSections(baseInstall({
      updateChannel: 'stable',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.22.3', commitsAhead: 59 },
    } as Partial<InstallationRecord>)) as unknown as UpdateSection[]
    const field = sections.find((s) => s.tab === 'update')?.fields?.find((f) => f.id === 'updateChannel')
    expect((field as unknown as { value: string }).value).toBe('latest')
  })
})

describe('updateSections — copy (duplicate) prompt default', () => {
  interface ActionWithPrompt { id: string; prompt?: { defaultValue?: string; uniquifyDefault?: boolean } }
  interface ActionsSection { title?: string; actions?: ActionWithPrompt[] }

  it('pre-fills the duplicate prompt with the source name, flagged to resolve to the numbered name on show', () => {
    const sections = getDetailSections(baseInstall({ name: 'My Comfy' })) as unknown as ActionsSection[]
    const copy = sections
      .flatMap((s) => s.actions ?? [])
      .find((a) => a.id === 'copy')
    expect(copy).toBeDefined()
    expect(copy!.prompt?.defaultValue).toBe('My Comfy')
    // uniquifyDefault tells the renderer to show the name it will actually get.
    expect(copy!.prompt?.uniquifyDefault).toBe(true)
  })

  it('pre-fills the copy & update prompt with the source name only, never the target version (which goes stale)', () => {
    // commitsAhead makes the effective channel `latest`, so the `latest` card
    // exposes the copy-update action for an install that's on stable.
    const copyUpdate = getChannelAction(
      baseInstall({ name: 'My Comfy', updateChannel: 'stable' }),
      'latest',
      'copy-update'
    )
    expect(copyUpdate).toBeDefined()
    // Guard against version-stamping regressions like "My Comfy (v0.3.20+12)".
    expect(copyUpdate!.prompt?.defaultValue).toBe('My Comfy')
    // Flagged so the renderer shows the numbered name it will actually be saved as.
    expect(copyUpdate!.prompt?.uniquifyDefault).toBe(true)
  })
})

describe('updateSections — PyTorch picker', () => {
  interface PytorchOption {
    value: string
    description?: string
    groupPath?: Array<{ id: string; label: string }>
    data?: { actions?: UpdateAction[] }
  }
  interface PytorchField {
    id: string
    options: PytorchOption[]
    groupLabels?: string[]
  }

  function getPytorchField(installation: InstallationRecord): PytorchField | undefined {
    const sections = getDetailSections(installation) as unknown as UpdateSection[]
    return sections
      .filter((s) => s.tab === 'update')
      .flatMap((s) => s.fields ?? [])
      .find((f) => f.id === 'pytorchStack') as unknown as PytorchField | undefined
  }

  function getPytorchOptions(installation: InstallationRecord): PytorchOption[] {
    return getPytorchField(installation)?.options ?? []
  }

  function indexEntry(overrides: Partial<TorchStackEntry> = {}): TorchStackEntry {
    return {
      stackId: 'pytorch-index:cu128:2.11.0',
      variant: 'win-nvidia',
      pythonVersion: '',
      packages: { torch: '2.11.0+cu128', torchvision: '0.26.0+cu128', torchaudio: '2.11.0+cu128' },
      source: { kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu128' },
      date: '2026-03-25',
      comfyuiVersion: '',
      ...overrides,
    }
  }

  function getIndexOption(): PytorchOption | undefined {
    const options = getPytorchOptions(baseInstall({ variant: 'win-nvidia' } as Partial<InstallationRecord>))
    return options.find((o) => o.value === 'pytorch-index:cu128:2.11.0')
  }

  it('renders an index-served entry as a pip apply: localized note shown, no bundle size, pip confirm copy', () => {
    vi.mocked(getCachedTorchStacks).mockReturnValue([indexEntry({
      noteKey: 'pytorchIndexNoteCu128',
      note: 'remote plain-text fallback',
    })])
    const option = getIndexOption()
    expect(option).toBeDefined()
    // The known noteKey wins over the remote plain-text fallback.
    expect(option!.description).toContain('Requires CUDA 12.8 drivers')
    expect(option!.description).not.toContain('remote plain-text fallback')
    expect(option!.description).not.toContain('pytorchDownloadSize')
    const action = option!.data?.actions?.find((a) => a.id === 'change-pytorch')
    expect(action).toBeDefined()
    // t() returns bare keys here, so assert on the key the copy is built from.
    expect(action!.confirm?.message).toContain('standalone.pytorchConfirmMessagePip')
  })

  it('falls back to the plain-text note when the noteKey is unknown to this app version', () => {
    vi.mocked(getCachedTorchStacks).mockReturnValue([indexEntry({
      noteKey: 'pytorchIndexNoteFromNewerManifest',
      note: 'Newest CUDA build.',
    })])
    const option = getIndexOption()
    expect(option!.description).toContain('Newest CUDA build.')
    expect(option!.description).not.toContain('pytorchIndexNoteFromNewerManifest')
  })

  it('omits the note cleanly when the noteKey is unknown and no plain-text note exists', () => {
    vi.mocked(getCachedTorchStacks).mockReturnValue([indexEntry({
      noteKey: 'pytorchIndexNoteFromNewerManifest',
    })])
    const option = getIndexOption()
    expect(option!.description).not.toContain('pytorchIndexNoteFromNewerManifest')
  })

  it('surfaces a compute-cap mismatch in the description and the confirm dialog, still selectable', () => {
    vi.mocked(getCachedTorchStacks).mockReturnValue([indexEntry({
      capWarning: { min: 7.5, max: 12.0, detected: [6.1] },
    })])
    const option = getIndexOption()
    expect(option!.description).toContain('standalone.pytorchCapWarning')
    const action = option!.data?.actions?.find((a) => a.id === 'change-pytorch')
    expect(action).toBeDefined() // informational: the change stays offered
    expect(action!.confirm?.message).toContain('standalone.pytorchCapConfirmWarning')
  })

  it('shows no compute-cap warning on a compatible entry', () => {
    vi.mocked(getCachedTorchStacks).mockReturnValue([indexEntry({})])
    const option = getIndexOption()
    expect(option!.description).not.toContain('standalone.pytorchCapWarning')
    const action = option!.data?.actions?.find((a) => a.id === 'change-pytorch')
    expect(action!.confirm?.message).not.toContain('standalone.pytorchCapConfirmWarning')
  })

  describe('backend-series grouping (cascading dropdowns)', () => {
    const install = (): InstallationRecord => baseInstall({ variant: 'win-nvidia' } as Partial<InstallationRecord>)

    function cudaEntry(tag: string, torch: string): TorchStackEntry {
      return indexEntry({
        stackId: `pytorch-index:${tag}:${torch}`,
        packages: { torch: `${torch}+${tag}`, torchvision: `0.26.0+${tag}`, torchaudio: `${torch}+${tag}` },
        source: { kind: 'pytorch-index', backend: 'cuda', indexTag: tag },
      })
    }

    it('emits one groupPath level per option when the catalog spans several CUDA series', () => {
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        cudaEntry('cu130', '2.10.0'),
        cudaEntry('cu128', '2.11.0'),
      ])
      const field = getPytorchField(install())!
      expect(field.groupLabels).toEqual(['standalone.pytorchSeriesLabel'])
      const cu130 = field.options.find((o) => o.value === 'pytorch-index:cu130:2.10.0')
      const cu128 = field.options.find((o) => o.value === 'pytorch-index:cu128:2.11.0')
      expect(cu130!.groupPath).toEqual([{ id: 'cu130', label: 'CUDA 13.0 (cu130)' }])
      expect(cu128!.groupPath).toEqual([{ id: 'cu128', label: 'CUDA 12.8 (cu128)' }])
    })

    it('splits nightly (dev) builds into their own clearly-labeled series with a standing warning', () => {
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        cudaEntry('cu132', '2.13.0.dev20260720'),
        cudaEntry('cu130', '2.10.0'),
      ])
      const field = getPytorchField(install())!
      const nightly = field.options.find((o) => o.value === 'pytorch-index:cu132:2.13.0.dev20260720')
      const stable = field.options.find((o) => o.value === 'pytorch-index:cu130:2.10.0')
      // A nightly never shares a series with stable builds - selecting one
      // must be a deliberate step past a labeled fork in the first dropdown.
      expect(nightly!.groupPath?.[0]?.id).toBe('nightly-cu132')
      expect(nightly!.groupPath?.[0]?.label).toContain('pytorchSeriesNightly')
      expect(stable!.groupPath).toEqual([{ id: 'cu130', label: 'CUDA 13.0 (cu130)' }])
      expect(nightly!.description).toContain('standalone.pytorchNightlyNote')
      expect(stable!.description).not.toContain('standalone.pytorchNightlyNote')
    })

    it('a nightly and a stable build of the same tag still fork into two series', () => {
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        cudaEntry('cu132', '2.13.0.dev20260720'),
        cudaEntry('cu132', '2.12.0'),
      ])
      const field = getPytorchField(install())!
      const ids = field.options.map((o) => o.groupPath?.[0]?.id)
      expect(ids).toContain('nightly-cu132')
      expect(ids).toContain('cu132')
    })

    it('places multiple versions of the same series in one group', () => {
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        cudaEntry('cu130', '2.10.0'),
        cudaEntry('cu130', '2.9.1'),
        cudaEntry('cu128', '2.11.0'),
      ])
      const options = getPytorchOptions(install())
      const ids = options
        .filter((o) => o.value.includes('cu130'))
        .map((o) => o.groupPath?.[0]?.id)
      expect(ids).toEqual(['cu130', 'cu130'])
    })

    it('keeps the flat picker (no groupPath, no groupLabels) for a single series', () => {
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        cudaEntry('cu130', '2.10.0'),
        cudaEntry('cu130', '2.9.1'),
      ])
      const field = getPytorchField(install())!
      expect(field.groupLabels).toBeUndefined()
      for (const o of field.options) expect(o.groupPath).toBeUndefined()
    })

    it('gives the synthetic current entry a full path so the cascade stays coherent', () => {
      // No installed torch is detected in tests, so the synthetic entry lands
      // in the untagged "Default" series while real stacks keep theirs.
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        cudaEntry('cu130', '2.10.0'),
        cudaEntry('cu128', '2.11.0'),
      ])
      const options = getPytorchOptions(install())
      const synthetic = options.find((o) => o.value === 'pytorch-current')
      expect(synthetic!.groupPath).toEqual([
        { id: 'default', label: 'standalone.pytorchSeriesDefault' },
      ])
    })

    it('orders grouped options newest-first across sources (bundle vs index)', () => {
      // The catalog concatenates bundle stacks before index stacks; grouped
      // mode must re-sort by date so group-switching (first match) lands on
      // the newest build, not on an older bundle.
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        indexEntry({
          stackId: 'bundle:cu130:2.9.0',
          packages: { torch: '2.9.0+cu130', torchvision: '0.24.0+cu130', torchaudio: '2.9.0+cu130' },
          source: { kind: 'comfy-bundle', variant: 'win-nvidia', bundleTag: 'v1' },
          date: '2026-01-01',
        }),
        { ...cudaEntry('cu130', '2.10.0'), date: '2026-03-25' },
        { ...cudaEntry('cu128', '2.11.0'), date: '2026-03-25' },
      ])
      const options = getPytorchOptions(install())
      const cu130Values = options
        .filter((o) => o.groupPath?.[0]?.id === 'cu130')
        .map((o) => o.value)
      expect(cu130Values).toEqual(['pytorch-index:cu130:2.10.0', 'bundle:cu130:2.9.0'])
    })

    it('puts the synthetic current entry last in grouped mode, first in flat mode', () => {
      const stacks = [cudaEntry('cu130', '2.10.0'), cudaEntry('cu128', '2.11.0')]
      vi.mocked(getCachedTorchStacks).mockReturnValue(stacks)
      const grouped = getPytorchOptions(install())
      expect(grouped[grouped.length - 1]!.value).toBe('pytorch-current')

      vi.mocked(getCachedTorchStacks).mockReturnValue([stacks[0]!])
      const flat = getPytorchOptions(install())
      expect(flat[0]!.value).toBe('pytorch-current')
    })

    it('grouped options still carry the opaque stackId in their action payload', () => {
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        cudaEntry('cu130', '2.10.0'),
        cudaEntry('cu128', '2.11.0'),
      ])
      for (const option of getPytorchOptions(install())) {
        const action = option.data?.actions?.find((a) => a.id === 'change-pytorch')
        if (!action) continue // synthetic current entry has no action
        expect(action.data?.stackId).toBe(option.value)
      }
    })

    it('labels ROCm series by their runtime version', () => {
      vi.mocked(getCachedTorchStacks).mockReturnValue([
        indexEntry({
          stackId: 'pytorch-index:rocm7.2.1:2.10.0',
          variant: 'linux-amd',
          packages: { torch: '2.10.0+rocm7.2.1', torchvision: '0.26.0+rocm7.2.1', torchaudio: '2.10.0+rocm7.2.1' },
          source: { kind: 'pytorch-index', backend: 'rocm', indexTag: 'rocm7.2.1' },
        }),
        indexEntry({
          stackId: 'pytorch-index:rocm6.4:2.9.0',
          variant: 'linux-amd',
          packages: { torch: '2.9.0+rocm6.4', torchvision: '0.25.0+rocm6.4', torchaudio: '2.9.0+rocm6.4' },
          source: { kind: 'pytorch-index', backend: 'rocm', indexTag: 'rocm6.4' },
        }),
      ])
      const options = getPytorchOptions(baseInstall({ variant: 'linux-amd' } as Partial<InstallationRecord>))
      const newer = options.find((o) => o.value === 'pytorch-index:rocm7.2.1:2.10.0')
      expect(newer!.groupPath).toEqual([{ id: 'rocm7.2.1', label: 'ROCm 7.2.1' }])
    })
  })
})
