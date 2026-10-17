import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ModelsTab from './ModelsTab.vue'
import NodesTab from './NodesTab.vue'
import type {
  InstallContentsFacet,
  InstallContentsPage,
  InstallModel,
  InstallNodePack,
  Installation
} from '../../types/ipc'

function page<T>(
  items: T[],
  extra: { facets?: InstallContentsFacet[]; managed?: true } = {}
): InstallContentsPage<T> {
  return { ok: true, items, nextCursor: null, total: items.length, truncated: false, ...extra }
}

const api = {
  listInstallModels: vi.fn(),
  listInstallNodes: vi.fn(),
  comfybuilder: {
    getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
    onAuthChanged: vi.fn(() => () => {})
  }
}
Object.defineProperty(window, 'api', { value: api, configurable: true })

const local = { id: 'l', sourceCategory: 'local' } as Installation
const cloud = { id: 'c', sourceCategory: 'cloud' } as Installation
const filterLabels = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .get('[data-testid="models-filter"]')
    .findAll('button')
    .map((b) => b.text())

describe('ModelsTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api.listInstallModels.mockReset()
  })

  it("filters a local build's models by type", async () => {
    const sdxl: InstallModel = { name: 'sdxl.safetensors', folder: 'checkpoints', size: 1 }
    api.listInstallModels.mockResolvedValue(
      page([sdxl], {
        facets: [
          { value: 'checkpoints', count: 2 },
          { value: 'loras', count: 1 }
        ]
      })
    )
    const wrapper = mount(ModelsTab, { props: { installation: local } })
    await flushPromises()
    expect(filterLabels(wrapper)).toEqual(['All 3', 'checkpoints 2', 'loras 1'])
    expect(wrapper.get('[data-testid="dashboard-models"]').text()).toContain('sdxl.safetensors')

    await wrapper.get('[data-testid="models-filter"]').findAll('button')[2]!.trigger('click')
    await flushPromises()
    expect(api.listInstallModels).toHaveBeenLastCalledWith(
      'l',
      expect.objectContaining({ filter: 'loras' })
    )
  })

  it('offers All, My models and Public models on Comfy Cloud, and marks public models', async () => {
    api.listInstallModels.mockResolvedValue(
      page([{ name: 'flux.safetensors', folder: 'checkpoints', size: 1, public: true }], {
        facets: [
          { value: 'all', count: 10 },
          { value: 'mine', count: 3 },
          { value: 'public', count: 7 }
        ]
      })
    )
    const wrapper = mount(ModelsTab, { props: { installation: cloud } })
    await flushPromises()
    expect(filterLabels(wrapper)).toEqual(['All 10', 'My models 3', 'Public models 7'])
    expect(wrapper.get('[data-testid="dashboard-models"]').text()).toContain('Public')
  })
})

describe('NodesTab', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("lists a local build's packs with their version and state", async () => {
    const packs: InstallNodePack[] = [
      { id: 'a', name: 'ComfyUI-Impact-Pack', version: '8.1', enabled: true },
      { id: 'b', name: 'rgthree-comfy', enabled: false }
    ]
    api.listInstallNodes.mockResolvedValue(page(packs))
    const wrapper = mount(NodesTab, { props: { installation: local } })
    await flushPromises()
    const rows = wrapper
      .findAll('[role="row"]')
      .slice(1)
      .map((r) => r.text())
    expect(rows[0]).toContain('8.1')
    expect(rows[0]).toContain('Enabled')
    expect(rows[1]).toContain('Disabled')
  })

  it("lists Comfy Cloud's packs with their node count, and says Cloud manages them", async () => {
    api.listInstallNodes.mockResolvedValue(
      page([{ id: 'v', name: 'ComfyUI-VideoHelperSuite', enabled: true, nodeCount: 12 }], {
        managed: true
      })
    )
    const wrapper = mount(NodesTab, { props: { installation: cloud } })
    await flushPromises()
    expect(wrapper.text()).toContain('keeps them up to date')
    expect(wrapper.findAll('[role="columnheader"]').map((h) => h.text())).toEqual(['Name', 'Nodes'])
    expect(wrapper.findAll('[role="row"]')[1]!.text()).toContain('12')
  })
})
