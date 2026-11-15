import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AssetsView from './AssetsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import type { AssetSummary, Installation } from '../types/ipc'

const listAssets = vi.fn()
const listLocalAssets = vi.fn()
const downloadAsset = vi.fn()
const alert = vi.fn()
const signIn = vi.fn().mockResolvedValue({ signedIn: false })

vi.mock('../composables/useModal', () => ({
  useModal: () => ({ alert })
}))

function asset(
  id: string,
  name: string,
  kind: AssetSummary['kind'],
  extra: Partial<AssetSummary> = {}
): AssetSummary {
  return {
    id,
    name,
    kind,
    sizeBytes: 1024,
    createdAt: null,
    mimeType: null,
    tags: ['output'],
    previewUrl: null,
    thumbnailUrl: null,
    ...extra
  }
}

function cloudBuild(id: string): Installation {
  return { id, name: id, sourceLabel: 'Comfy Cloud', sourceCategory: 'cloud' }
}

async function mountAssets(local: AssetSummary[] | Promise<AssetSummary[]> = []) {
  listLocalAssets.mockReturnValue(Promise.resolve(local))
  const wrapper = mount(AssetsView)
  await flushPromises()
  return wrapper
}

async function signInWith(cloud: AssetSummary[]): Promise<void> {
  useInstallationStore().installations = [cloudBuild('cloud')]
  listAssets.mockResolvedValue(cloud)
  useAuthStore().status = { signedIn: true }
  await flushPromises()
}

function assetNames(wrapper: Awaited<ReturnType<typeof mountAssets>>): string[] {
  return wrapper
    .get('[data-testid="assets-grid"]')
    .findAllComponents(Tooltip)
    .map((tip) => tip.props('text') as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  listLocalAssets.mockResolvedValue([])
  ;(window as unknown as { api: unknown }).api = {
    listAssets,
    listLocalAssets,
    downloadAsset,
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      signIn,
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

describe('AssetsView', () => {
  it('starts in masonry with file names and details hidden', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    expect(wrapper.get('[data-testid="assets-grid"]').classes()).toContain('columns-[200px]')
    expect(wrapper.get('[data-testid="asset-a"]').text()).not.toContain('forest.png')
  })

  it('opens with the view setup the user saved last time', async () => {
    window.localStorage.setItem('comfy.desktop.assets.layout', 'grid')
    window.localStorage.setItem('comfy.desktop.assets.showName', 'true')

    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    expect(wrapper.get('[data-testid="assets-grid"]').classes()).toContain('grid')
    expect(wrapper.get('[data-testid="asset-a"]').text()).toContain('forest.png')
  })

  it('shows the files on this computer without any build running or a Cloud login', async () => {
    const wrapper = await mountAssets([
      asset('/out/surfer.mp4', 'surfer.mp4', 'video'),
      asset('/out/forest.png', 'forest.png', 'image')
    ])

    expect(listLocalAssets).toHaveBeenCalledOnce()
    expect(listAssets).not.toHaveBeenCalled()
    expect(assetNames(wrapper)).toEqual(['surfer.mp4', 'forest.png'])
  })

  it('shows an image card from its small thumbnail', async () => {
    const wrapper = await mountAssets([
      asset('/out/forest.png', 'forest.png', 'image', {
        previewUrl: 'comfy-output://file/full',
        thumbnailUrl: 'comfy-output://file/full?thumbnail=1'
      })
    ])

    expect(wrapper.get('img').attributes('src')).toBe('comfy-output://file/full?thumbnail=1')
  })

  it('mixes this computer and the signed-in Cloud workspace, newest first', async () => {
    const wrapper = await mountAssets([
      asset('/out/old.png', 'old.png', 'image', { createdAt: '2026-11-01T00:00:00Z' })
    ])
    await signInWith([asset('c1', 'cloud.png', 'image', { createdAt: '2026-11-05T00:00:00Z' })])

    expect(listAssets.mock.calls.map(([id]) => id)).toEqual(['cloud'])
    expect(assetNames(wrapper)).toEqual(['cloud.png', 'old.png'])
  })

  it('loads the Cloud assets once when the account has several Cloud builds', async () => {
    useInstallationStore().installations = [cloudBuild('cloud-a'), cloudBuild('cloud-b')]
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets()
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(listAssets.mock.calls.map(([id]) => id)).toEqual(['cloud-a'])
    expect(assetNames(wrapper)).toEqual(['forest.png'])
  })

  it('filters by asset type and by name', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image'),
      asset('c', 'terraces.png', 'image')
    ])

    await wrapper.get('[data-testid="assets-filter"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    document.querySelector<HTMLElement>('[data-testid="assets-filter-image"]')!.click()
    await flushPromises()
    expect(assetNames(wrapper)).toEqual(['forest.png', 'terraces.png'])

    await wrapper.get('input').setValue('terr')
    expect(assetNames(wrapper)).toEqual(['terraces.png'])
  })

  it('asks a signed-out user with no files to log in to Comfy Cloud', async () => {
    useInstallationStore().installations = [cloudBuild('cloud')]
    const wrapper = await mountAssets()

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('Log in to see your assets')
    expect(
      wrapper.get('[data-testid="assets-empty-action"]').classes(),
      'the label keeps the inverted button text color'
    ).toContain('text-background')
    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('ignores a cancelled log-in', async () => {
    signIn.mockRejectedValueOnce(new Error('cancelled'))
    const wrapper = await mountAssets()

    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="assets-empty-action"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('tells a signed-in user with no assets where they come from', async () => {
    const wrapper = await mountAssets()
    await signInWith([])

    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('No assets yet')
    expect(wrapper.get('[data-testid="assets-empty"] p').text()).toBe('Open an app to make assets.')
    expect(wrapper.find('[data-testid="assets-empty-action"]').exists()).toBe(false)
  })

  it('shows a skeleton card per slot while the first load is pending', async () => {
    const wrapper = await mountAssets(new Promise(() => {}))

    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)
  })

  it('downloads a file on this computer from its card', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])

    await wrapper.get('[data-testid="asset-download-b"]').trigger('click')

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('local', 'b', 'forest.png')
  })

  it('downloads a Cloud file through the Cloud build', async () => {
    const wrapper = await mountAssets()
    await signInWith([asset('c', 'cloud.png', 'image')])

    await wrapper.get('[data-testid="asset-download-c"]').trigger('click')

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('cloud', 'c', 'cloud.png')
  })

  it('starts one download at a time for a file', async () => {
    let finish: () => void = () => {}
    downloadAsset.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])
    const button = wrapper.get('[data-testid="asset-download-a"]')

    await button.trigger('click')
    await button.trigger('click')

    expect(downloadAsset).toHaveBeenCalledOnce()
    expect(button.attributes('disabled')).toBeDefined()
    finish()
    await flushPromises()
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('tells the user when a download fails', async () => {
    downloadAsset.mockRejectedValue(new Error('offline'))
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    await wrapper.get('[data-testid="asset-download-a"]').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't download asset",
      message: 'forest.png'
    })
  })

  it('does not reload when a build changes but the account stays the same', async () => {
    await mountAssets([asset('a', 'forest.png', 'image')])

    useInstallationStore().installations = [
      { id: 'lab', name: 'Video Lab', sourceLabel: 'Standalone', sourceCategory: 'local' }
    ]
    await flushPromises()

    expect(listLocalAssets).toHaveBeenCalledOnce()
  })

  it('delays the first name tooltip, then shows the rest at once until the pointer leaves', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const delays = () => wrapper.findAllComponents(Tooltip).map((tip) => tip.props('delayMs'))
    expect(delays()).toEqual([600, 600])

    vi.useFakeTimers()
    try {
      await wrapper.get('[data-testid="assets-grid"]').trigger('pointerenter')
      await vi.advanceTimersByTimeAsync(600)
      expect(delays()).toEqual([0, 0])

      await wrapper.get('[data-testid="assets-grid"]').trigger('pointerleave')
      expect(delays()).toEqual([600, 600])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the files on this computer when Cloud fails', async () => {
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])
    useInstallationStore().installations = [cloudBuild('cloud')]
    listAssets.mockRejectedValue(new Error('offline'))
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(assetNames(wrapper)).toEqual(['forest.png'])
    expect(wrapper.find('[data-testid="assets-empty"]').exists()).toBe(false)
  })

  it('reloads when the signed-in workspace changes', async () => {
    await mountAssets([asset('a', 'forest.png', 'image')])

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(listLocalAssets).toHaveBeenCalledTimes(2)
  })

  it('clears the previous workspace assets while the new workspace loads', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])
    listLocalAssets.mockReturnValueOnce(new Promise(() => {}))

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(wrapper.find('[data-testid="assets-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assets-skeleton"]').exists()).toBe(true)
  })

  it('says nothing matches when a search hides every asset', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    await wrapper.get('input').setValue('zzz')

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain('No matching assets')
  })

  it('reports a failed load', async () => {
    const wrapper = await mountAssets(Promise.reject(new Error('disk')))

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })
})
