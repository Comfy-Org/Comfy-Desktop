import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AssetsTab from './AssetsTab.vue'
import type { InstallAsset, Installation } from '../../types/ipc'

const assets: InstallAsset[] = [
  {
    id: 'output/a.png',
    name: 'a.png',
    mediaType: 'image',
    url: 'comfy-media://local/i/output/a.png',
    category: 'output',
    size: 1024,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    revealable: true
  },
  {
    id: 'cloud-1',
    name: 'b.mp4',
    mediaType: 'video',
    url: 'comfy-media://cloud/cloud-1',
    category: 'output',
    size: 2048,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    revealable: false,
    mimeType: 'video/mp4',
    hash: 'blake3:abc'
  }
]

const api = {
  listInstallAssets: vi.fn(async () => ({
    ok: true as const,
    items: assets,
    nextCursor: null,
    total: 2,
    truncated: false
  })),
  revealInstallAsset: vi.fn(async () => ({ ok: true })),
  comfybuilder: {
    getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
    onAuthChanged: vi.fn(() => () => {})
  }
}
Object.defineProperty(window, 'api', { value: api, configurable: true })

const inst = { id: 'i', sourceCategory: 'local' } as Installation

describe('AssetsTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api.revealInstallAsset.mockClear()
  })

  it('shows images and video served by comfy-media', async () => {
    const wrapper = mount(AssetsTab, { props: { installation: inst } })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('comfy-media://local/i/output/a.png')
    expect(wrapper.get('video').attributes('src')).toBe('comfy-media://cloud/cloud-1')
  })

  it('opens an asset beside the gallery, and reveals a local one from there', async () => {
    const wrapper = mount(AssetsTab, { props: { installation: inst }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-testid="asset-detail"]').exists()).toBe(false)

    await wrapper.get('[aria-label="a.png"]').trigger('click')
    const panel = wrapper.get('[data-testid="asset-detail"]')
    expect(panel.text()).toContain('output/a.png')
    expect(panel.text()).toContain('1 KB')
    await panel
      .findAll('button')
      .find((b) => b.text() === 'Show in folder')!
      .trigger('click')
    expect(api.revealInstallAsset).toHaveBeenCalledWith('i', 'output/a.png')
  })

  it("shows a Cloud asset's id and hash, with nothing to reveal", async () => {
    const wrapper = mount(AssetsTab, { props: { installation: inst } })
    await flushPromises()
    await wrapper.get('[aria-label="b.mp4"]').trigger('click')
    const panel = wrapper.get('[data-testid="asset-detail"]')
    expect(panel.text()).toContain('blake3:abc')
    expect(panel.text()).toContain('video/mp4')
    expect(panel.text()).not.toContain('Show in folder')
  })

  it('moves through assets with the arrow keys and closes on Escape', async () => {
    const wrapper = mount(AssetsTab, { props: { installation: inst }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[aria-label="a.png"]').trigger('keydown', { key: ' ' })
    // A player keeps its own arrow keys.
    await wrapper.get('video').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('[data-testid="asset-detail"]').attributes('aria-label')).toBe('a.png')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(wrapper.get('[data-testid="asset-detail"]').attributes('aria-label')).toBe('b.mp4')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="asset-detail"]').exists()).toBe(false)
  })

  it('shows skeleton tiles while the first page loads', async () => {
    api.listInstallAssets.mockImplementationOnce(() => new Promise(() => {}))
    const wrapper = mount(AssetsTab, { props: { installation: inst } })
    await flushPromises()
    expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe('Loading')
  })
})
