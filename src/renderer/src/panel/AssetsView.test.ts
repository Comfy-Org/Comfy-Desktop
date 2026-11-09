import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AssetsView from './AssetsView.vue'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AssetSummary, Installation } from '../types/ipc'

const listAssets = vi.fn()
const downloadAsset = vi.fn()

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

async function mountAssets(running: Installation[], stopped: Installation[] = []) {
  useInstallationStore().installations = [...running, ...stopped]
  const sessions = useSessionStore()
  for (const inst of running) {
    sessions.runningInstances.set(inst.id, {
      installationId: inst.id,
      installationName: inst.name,
      mode: 'app'
    })
  }
  const wrapper = mount(AssetsView)
  await flushPromises()
  return wrapper
}

function assetNames(wrapper: Awaited<ReturnType<typeof mountAssets>>): string[] {
  return wrapper.findAll('[data-testid^="asset-"] .truncate.font-medium').map((n) => n.text())
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

  it('reports a failed load', async () => {
    listAssets.mockRejectedValue(new Error('offline'))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })
})
