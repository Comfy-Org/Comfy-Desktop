import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'

import { useSessionStore } from '../../stores/sessionStore'
import BuildOverview from './BuildOverview.vue'
import type { BuildOverviewModel, OverviewChannel } from './overviewModel'
import type { ActionDef, Installation } from '../../types/ipc'

const updateNow: ActionDef = { id: 'update-comfyui', label: 'Update Now', style: 'primary' }
const copyUpdate: ActionDef = { id: 'copy-update', label: 'Copy & Update' }
const switchChannel: ActionDef = { id: 'switch-channel', label: 'Switch Channel' }
const checkUpdate: ActionDef = { id: 'check-update', label: 'Check for updates' }
const changeTorch: ActionDef = { id: 'change-pytorch', label: 'Change PyTorch' }
const copyTorch: ActionDef = { id: 'copy-pytorch', label: 'Copy & Change PyTorch' }

const INSTALL = {
  id: 'inst-1',
  name: 'Flux Studio',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed'
} as Installation

function channel(overrides: Partial<OverviewChannel>): OverviewChannel {
  return {
    value: 'stable',
    label: 'Stable',
    description: 'Tested releases',
    installedVersion: 'v0.3.60',
    latestVersion: 'v0.3.60',
    lastCheckedAt: Date.now() - 5 * 60 * 1000,
    updateAvailable: false,
    enriching: false,
    actions: [],
    ...overrides
  }
}

function model(overrides: Partial<BuildOverviewModel> = {}): BuildOverviewModel {
  return {
    channelLabel: 'Update Channel',
    currentChannel: 'stable',
    channels: [
      channel({}),
      channel({ value: 'latest', label: 'Latest', description: 'Every commit', actions: [] })
    ],
    checkAction: checkUpdate,
    torch: {
      label: 'PyTorch',
      current: '2.8.0+cu128',
      groups: [
        {
          id: 'cu128',
          label: 'CUDA 12.8 (cu128)',
          versions: [
            { value: 'a', version: '2.8.0+cu128', current: true, actions: [] },
            {
              value: 'b',
              version: '2.7.1+cu128',
              description: 'torchvision 0.22.1',
              current: false,
              actions: [changeTorch, copyTorch]
            }
          ]
        }
      ]
    },
    facts: {
      variant: { label: 'Variant', value: 'NVIDIA (CUDA)' },
      python: { label: 'Python', value: '3.12.9' },
      location: { label: 'Location', value: '/builds/flux-studio' },
      'active-port': { label: 'Port', value: '8188' }
    },
    ...overrides
  }
}

function mountOverview(props: Record<string, unknown> = {}): VueWrapper {
  return mount(BuildOverview, {
    props: {
      installation: INSTALL,
      model: model(),
      diskUsage: '6.20 GB',
      diskFree: '412.00 GB',
      ...props
    },
    attachTo: document.body
  })
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

async function openMenu(wrapper: VueWrapper, testId: string): Promise<void> {
  await wrapper.get(`[data-testid="${testId}"]`).trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
}

async function openSubmenu(testId: string): Promise<void> {
  byTestId(testId)!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
  )
  await flushPromises()
}

async function select(testId: string): Promise<void> {
  byTestId(testId)!.click()
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createTestingPinia({ stubActions: false }))
  ;(window as unknown as { api: Record<string, unknown> }).api = { openPath: vi.fn() }
})

describe('BuildOverview — ComfyUI card', () => {
  it('shows the version, the channel and an up-to-date build with its last check', () => {
    const w = mountOverview()
    expect(w.get('[data-testid="build-overview-comfyui-version"]').text()).toBe('v0.3.60')
    expect(w.get('[data-testid="build-overview-channel"]').text()).toBe('Stable')
    const update = w.get('[data-testid="build-overview-update"]').text()
    expect(update).toContain('Up to date')
    expect(update).toContain('Checked 5m ago')
  })

  it('says a build never checked for updates is not checked yet', () => {
    const w = mountOverview({
      model: model({ channels: [channel({ latestVersion: undefined, lastCheckedAt: undefined })] })
    })
    const update = w.get('[data-testid="build-overview-update"]').text()
    expect(update).toContain('Not checked yet')
    expect(update).not.toContain('Up to date')
    expect(w.find('[data-testid="update-action-check-update"]').exists()).toBe(true)
  })

  it('checks for updates from the card and spins while it checks', async () => {
    const w = mountOverview()
    await w.get('[data-testid="update-action-check-update"]').trigger('click')
    expect(w.emitted('action')).toEqual([[checkUpdate]])

    await w.setProps({ runningActionIds: new Set(['check-update']) })
    const button = w.get('[data-testid="update-action-check-update"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.find('.animate-spin').exists()).toBe(true)
  })

  it('offers the update with its snapshot note, and Copy & Update in the split menu', async () => {
    const w = mountOverview({
      model: model({
        channels: [
          channel({
            latestVersion: 'v0.3.65',
            updateAvailable: true,
            actions: [updateNow, copyUpdate]
          })
        ]
      })
    })
    const update = w.get('[data-testid="build-overview-update"]').text()
    expect(update).toContain('v0.3.65 available')
    expect(update).toContain('Saves a snapshot first')
    expect(w.find('[data-testid="update-action-check-update"]').exists()).toBe(false)

    await w.get('[data-testid="update-action-update-comfyui"]').trigger('click')
    expect(w.emitted('action')).toEqual([[updateNow]])

    await openMenu(w, 'build-overview-update-menu')
    await select('update-action-copy-update')
    expect(w.emitted('action')).toEqual([[updateNow], [copyUpdate]])
  })

  it('lists each channel with what it means and switches to the picked one', async () => {
    const w = mountOverview({
      model: model({
        channels: [
          channel({}),
          channel({
            value: 'latest',
            label: 'Latest',
            description: 'Every commit',
            actions: [switchChannel]
          })
        ]
      })
    })
    await openMenu(w, 'build-overview-channel')
    expect(byTestId('build-overview-channel-latest')!.textContent).toContain('Every commit')
    await select('build-overview-channel-latest')

    expect(w.get('[data-testid="build-overview-channel"]').text()).toBe('Latest')
    expect(w.get('[data-testid="build-overview-update"]').text()).toContain('Switch to Latest')
    await w.get('[data-testid="update-action-switch-channel"]').trigger('click')
    expect(w.emitted('action')).toEqual([[switchChannel]])
  })

  it('says a picked channel has no version info yet when it has nothing to run', async () => {
    const w = mountOverview()
    await openMenu(w, 'build-overview-channel')
    await select('build-overview-channel-latest')
    expect(w.get('[data-testid="build-overview-update"]').text()).toContain(
      'Select this channel and check for updates'
    )
  })
})

describe('BuildOverview — PyTorch card', () => {
  it('shows the version in use and the build variant', () => {
    const card = mountOverview().get('[data-testid="build-overview-pytorch"]').text()
    expect(card).toContain('2.8.0+cu128')
    expect(card).toContain('NVIDIA (CUDA)')
  })

  it('changes PyTorch or copies and changes from the Change menu', async () => {
    const w = mountOverview()
    await openMenu(w, 'build-overview-pytorch-change')
    expect(byTestId('build-overview-pytorch-a')!.textContent).toContain('In use')
    expect(byTestId('build-overview-pytorch-b')!.textContent).toContain('torchvision 0.22.1')

    await openSubmenu('build-overview-pytorch-b')
    await select('update-action-copy-pytorch')
    expect(w.emitted('action')).toEqual([[copyTorch]])
  })

  it('has no Change menu when the build lists no PyTorch versions', () => {
    const w = mountOverview({
      model: model({ torch: null, facts: { pytorch: { label: 'PyTorch', value: '2.5.1' } } })
    })
    expect(w.get('[data-testid="build-overview-pytorch"]').text()).toContain('2.5.1')
    expect(w.find('[data-testid="build-overview-pytorch-change"]').exists()).toBe(false)
  })
})

describe('BuildOverview — facts', () => {
  it('shows the size on disk with the free space, and Python with its source', () => {
    const w = mountOverview()
    const disk = w.get('[data-testid="build-overview-disk"]').text()
    expect(disk).toContain('6.20 GB')
    expect(disk).toContain('412.00 GB free')
    const python = w.get('[data-testid="build-overview-python"]').text()
    expect(python).toContain('3.12.9')
    expect(python).toContain('Standalone')
  })

  it('opens the build folder from the Location row', async () => {
    const w = mountOverview()
    expect(w.get('[data-testid="build-overview-location"]').text()).toContain('/builds/flux-studio')
    await w.get('[data-testid="build-overview-open-folder"]').trigger('click')
    expect(window.api.openPath).toHaveBeenCalledWith('/builds/flux-studio')
  })

  it('shows the port only while the build runs', async () => {
    const w = mountOverview()
    expect(w.find('[data-testid="build-overview-port"]').exists()).toBe(false)

    useSessionStore().runningInstances.set('inst-1', {
      installationId: 'inst-1',
      installationName: 'Flux Studio',
      port: 8188,
      mode: 'window'
    })
    await flushPromises()
    expect(w.get('[data-testid="build-overview-port"]').text()).toContain('8188')
  })
})
