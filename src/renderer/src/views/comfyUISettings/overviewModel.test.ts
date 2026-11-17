import { describe, expect, it } from 'vitest'
import type { DetailSection } from '../../types/ipc'
import { buildOverviewModel, channelAction, splitVersion } from './overviewModel'

const updateAction = { id: 'update-comfyui', label: 'Update Now', style: 'primary' as const }
const copyUpdate = { id: 'copy-update', label: 'Copy & Update' }
const checkUpdate = { id: 'check-update', label: 'Check for updates' }
const changeTorch = { id: 'change-pytorch', label: 'Change PyTorch' }
const copyTorch = { id: 'copy-pytorch', label: 'Copy & Change PyTorch' }

function updateSections(): DetailSection[] {
  return [
    {
      tab: 'update',
      title: 'Updates',
      fields: [
        {
          id: 'updateChannel',
          label: 'Update Channel',
          value: 'stable',
          editType: 'channel-cards',
          tooltip: 'Where updates come from',
          options: [
            {
              value: 'stable',
              label: 'Stable',
              description: 'Tested releases',
              data: {
                installedVersion: 'v0.3.60',
                latestVersion: 'v0.3.65',
                lastChecked: '11/13/2026',
                lastCheckedAt: 1_000,
                updateAvailable: true,
                actions: [updateAction, copyUpdate]
              }
            },
            { value: 'latest', label: 'Latest', description: 'Every commit' }
          ]
        }
      ],
      actions: [checkUpdate]
    },
    {
      tab: 'update',
      title: 'PyTorch',
      fields: [
        {
          id: 'pytorchStack',
          label: 'PyTorch',
          value: 'cu128-a',
          editType: 'channel-cards',
          options: [
            {
              value: 'cu128-a',
              label: 'PyTorch 2.8.0+cu128',
              groupPath: [{ id: 'cu128', label: 'CUDA 12.8 (cu128)' }]
            },
            {
              value: 'cu128-b',
              label: 'PyTorch 2.7.1+cu128',
              description: 'torchvision 0.22.1',
              groupPath: [{ id: 'cu128', label: 'CUDA 12.8 (cu128)' }],
              data: { actions: [changeTorch, copyTorch] }
            },
            {
              value: 'cu126-a',
              label: 'PyTorch 2.6.0+cu126',
              groupPath: [{ id: 'cu126', label: 'CUDA 12.6 (cu126)' }],
              data: { actions: [changeTorch, copyTorch] }
            }
          ]
        }
      ]
    }
  ]
}

function statusSections(): DetailSection[] {
  return [
    {
      tab: 'status',
      fields: [
        { key: 'comfyui-version', label: 'ComfyUI', value: 'v0.3.60 + 2 commits (abc1234)' },
        { key: 'variant', label: 'Variant', value: 'NVIDIA (CUDA)' },
        { key: 'python', label: 'Python', value: '3.12.9' },
        { key: 'pytorch', label: 'PyTorch', value: '2.8.0+cu128' },
        { key: 'location', label: 'Location', value: '/builds/flux' },
        { key: 'lineage', label: 'Copied From', value: '—' }
      ]
    },
    { tab: 'status', fields: [{ key: 'active-port', label: 'Port', value: '8188' }] }
  ] as unknown as DetailSection[]
}

describe('buildOverviewModel', () => {
  it('is null for a build whose Update tab has no channel picker', () => {
    expect(buildOverviewModel([{ tab: 'update', fields: [] }], statusSections())).toBeNull()
  })

  it('reads the channels with their versions, last check and actions', () => {
    const model = buildOverviewModel(updateSections(), statusSections())!
    expect(model.currentChannel).toBe('stable')
    expect(model.channelLabel).toBe('Update Channel')
    expect(model.channelTooltip).toBe('Where updates come from')
    expect(model.channels.map((c) => c.value)).toEqual(['stable', 'latest'])
    const stable = model.channels[0]!
    expect(stable).toMatchObject({
      label: 'Stable',
      description: 'Tested releases',
      installedVersion: 'v0.3.60',
      latestVersion: 'v0.3.65',
      lastCheckedAt: 1_000,
      updateAvailable: true
    })
    expect(channelAction(stable, 'copy-update')).toEqual(copyUpdate)
    expect(model.channels[1]!.actions).toEqual([])
    expect(model.checkAction).toEqual(checkUpdate)
  })

  it('groups the PyTorch versions by series and marks the one in use', () => {
    const torch = buildOverviewModel(updateSections(), statusSections())!.torch!
    expect(torch.current).toBe('2.8.0+cu128')
    expect(torch.groups.map((g) => g.label)).toEqual(['CUDA 12.8 (cu128)', 'CUDA 12.6 (cu126)'])
    expect(torch.groups[0]!.versions).toEqual([
      {
        value: 'cu128-a',
        version: '2.8.0+cu128',
        description: undefined,
        current: true,
        actions: []
      },
      {
        value: 'cu128-b',
        version: '2.7.1+cu128',
        description: 'torchvision 0.22.1',
        current: false,
        actions: [changeTorch, copyTorch]
      }
    ])
  })

  it('has no PyTorch menu when the build lists no PyTorch versions', () => {
    const [updates] = updateSections()
    expect(buildOverviewModel([updates!], statusSections())!.torch).toBeNull()
  })

  it('keeps the facts with their labels and drops empty ones', () => {
    const { facts } = buildOverviewModel(updateSections(), statusSections())!
    expect(facts.variant).toEqual({ label: 'Variant', value: 'NVIDIA (CUDA)' })
    expect(facts.python?.value).toBe('3.12.9')
    expect(facts.location?.value).toBe('/builds/flux')
    expect(facts['active-port']).toEqual({ label: 'Port', value: '8188' })
    expect(facts.lineage).toBeUndefined()
  })
})

describe('splitVersion', () => {
  it('keeps a plain tag whole', () => {
    expect(splitVersion('v0.3.65')).toEqual({ main: 'v0.3.65', rest: '' })
  })

  it('puts the commits past a tag under the tag', () => {
    expect(splitVersion('v0.3.60 + 2 commits (abc1234)')).toEqual({
      main: 'v0.3.60',
      rest: '+ 2 commits (abc1234)'
    })
  })

  it('shows a dash when the version is unknown', () => {
    expect(splitVersion(undefined)).toEqual({ main: '—', rest: '' })
  })
})
