import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AssetsView from './AssetsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AssetSummary, Installation } from '../types/ipc'

const listAssets = vi.fn()
const downloadAsset = vi.fn()
const alert = vi.fn()

vi.mock('../composables/useModal', () => ({
  useModal: () => ({ alert })
}))

function asset(id: string, name: string, kind: AssetSummary['kind']): AssetSummary {
  return {
    id,
    name,
    kind,
    sizeBytes: 1024,
    createdAt: null,
    mimeType: null,
    tags: ['output'],
    previewUrl: null
  }
}

function build(id: string, name: string): Installation {
  return { id, name, sourceLabel: 'Standalone', sourceCategory: 'local' }
}

async function mountAssets(
  running: Installation[],
  stopped: Installation[] = [],
  options: { attachTo?: HTMLElement } = {}
) {
  useInstallationStore().installations = [...running, ...stopped]
  const sessions = useSessionStore()
  for (const inst of running) {
    sessions.runningInstances.set(inst.id, {
      installationId: inst.id,
      installationName: inst.name,
      mode: 'app'
    })
  }
  const wrapper = mount(AssetsView, options)
  await flushPromises()
  return wrapper
}

function assetNames(wrapper: Awaited<ReturnType<typeof mountAssets>>): string[] {
  return wrapper
    .findAll('[data-testid^="asset-open-"]')
    .map((card) => card.attributes('aria-label')!.replace('Open ', ''))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    listAssets,
    downloadAsset,
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

describe('AssetsView', () => {
  it('starts in masonry with file names and details hidden', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-grid"]').classes()).toContain('columns-[200px]')
    expect(wrapper.get('[data-testid="asset-a"]').text()).not.toContain('forest.png')
  })

  it('opens with the view setup the user saved last time', async () => {
    window.localStorage.setItem('comfy.desktop.assets.layout', 'grid')
    window.localStorage.setItem('comfy.desktop.assets.showName', 'true')
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-grid"]').classes()).toContain('grid')
    expect(wrapper.get('[data-testid="asset-a"]').text()).toContain('forest.png')
  })

  it('shows the assets of every running build and skips stopped ones', async () => {
    listAssets.mockImplementation(async (id: string) =>
      id === 'lab' ? [asset('a', 'surfer.mp4', 'video')] : [asset('b', 'forest.png', 'image')]
    )

    const wrapper = await mountAssets(
      [build('lab', 'Video Lab'), build('flux', 'Flux Sandbox')],
      [build('old', 'My Local 1')]
    )

    expect(listAssets.mock.calls.map(([id]) => id)).toEqual(['lab', 'flux'])
    expect(assetNames(wrapper)).toEqual(['surfer.mp4', 'forest.png'])
  })

  it('filters by asset type and by name', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image'),
      asset('c', 'terraces.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper
      .findAll('button')
      .find((n) => n.text() === 'Images')!
      .trigger('click')
    expect(assetNames(wrapper)).toEqual(['forest.png', 'terraces.png'])

    await wrapper.get('input').setValue('terr')
    expect(assetNames(wrapper)).toEqual(['terraces.png'])
  })

  it('asks for a running build when none is running', async () => {
    const wrapper = await mountAssets([], [build('old', 'My Local 1')])

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain(
      'Start a build to browse its assets.'
    )
  })

  it('marks Comfy Cloud as stopped while signed out', async () => {
    const cloud = { ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }
    useInstallationStore().installations = [cloud]

    const wrapper = mount(AssetsView)
    await flushPromises()

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain(
      'Start a build to browse its assets.'
    )
  })

  it('shows a skeleton card per slot while the first load is pending', async () => {
    listAssets.mockReturnValue(new Promise(() => {}))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)
  })

  it('opens an asset in the detail view, steps through assets and returns', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    const detail = wrapper.get('[data-testid="asset-detail"]')
    expect(detail.text()).toContain('Video Lab · 1 / 2')

    await wrapper.get('[data-testid="asset-detail-next"]').trigger('click')
    expect(wrapper.get('[data-testid="asset-detail-panel"] h2').text()).toBe('forest.png')

    await wrapper.get('[data-testid="asset-detail-download"]').trigger('click')
    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('lab', 'b', 'forest.png')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="asset-detail"]').exists()).toBe(false)
    expect(assetNames(wrapper)).toEqual(['surfer.mp4', 'forest.png'])
  })

  it('tells the user when a download fails', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    downloadAsset.mockRejectedValue(new Error('offline'))
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    await wrapper.get('[data-testid="asset-detail-download"]').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't download asset",
      message: 'forest.png'
    })
  })

  it('does not reload when the running builds stay the same', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    await mountAssets([build('lab', 'Video Lab')])

    useInstallationStore().installations = [{ ...build('lab', 'Video Lab Renamed') }]
    await flushPromises()

    expect(listAssets).toHaveBeenCalledOnce()
  })

  it('delays the first name tooltip, then shows the rest at once until the pointer leaves', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
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

  it('keeps the assets of builds that answered when another build fails', async () => {
    listAssets.mockImplementation(async (id: string) => {
      if (id === 'old') throw new Error('assets API disabled')
      return [asset('a', 'forest.png', 'image')]
    })

    const wrapper = await mountAssets([build('lab', 'Video Lab'), build('old', 'Old Build')])

    expect(assetNames(wrapper)).toEqual(['forest.png'])
    expect(wrapper.find('[data-testid="assets-empty"]').exists()).toBe(false)
  })

  it('reloads when the signed-in workspace changes', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    await mountAssets([build('lab', 'Video Lab')])

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(listAssets).toHaveBeenCalledTimes(2)
  })

  it('says nothing matches when a search hides every asset', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('input').setValue('zzz')

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain('No matching assets')
  })

  it('returns focus to the opened card when the detail view closes', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')], [], { attachTo: document.body })

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    await wrapper.get('[data-testid="asset-detail-back"]').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="asset-open-a"]').element)
    wrapper.unmount()
  })

  it('reports a failed load', async () => {
    listAssets.mockRejectedValue(new Error('offline'))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })
})
