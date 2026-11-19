import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import LoadSnapshotModal from './LoadSnapshotModal.vue'
import { BaseSelect } from '../components/ui'

function mountLoadSnapshot() {
  return mount(LoadSnapshotModal, {
    global: {
      stubs: {
        DesktopDialogSurface: { template: '<div><slot /></div>' }
      }
    }
  })
}

describe('LoadSnapshotModal', () => {
  it('names the screen Load snapshot and says it installs a build', async () => {
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    expect(wrapper.get('.setup-modal-title').text()).toBe('Load snapshot')
    expect(wrapper.get('.setup-modal-lead').text()).toBe('Load a snapshot file to install a build.')
  })

  it('shows Create build from the start, disabled until a snapshot file is picked', async () => {
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    const create = wrapper.get('.load-snapshot-create')
    expect(create.text()).toBe('Create build')
    expect(create.attributes('disabled')).toBeDefined()
  })
})

describe('LoadSnapshotModal preview', () => {
  const preview = {
    filePath: '/tmp/snap.json',
    installationName: 'Studio',
    snapshotCount: 1,
    snapshots: [],
    newestSnapshot: {
      comfyuiVersion: 'v0.4.2',
      pythonVersion: '3.12',
      createdAt: '2026-01-01T00:00:00Z',
      updateChannel: 'stable',
      comfyui: { variant: 'mps', releaseTag: '' },
      customNodes: [],
      pipPackages: {},
      pipPackageCount: 0
    }
  }

  function installApi(): void {
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      previewSnapshotFile: vi.fn().mockResolvedValue({ ok: true, preview }),
      detectGPU: vi.fn().mockResolvedValue(null),
      getFieldOptions: vi.fn(async (_source: string, fieldId: string) =>
        fieldId === 'release'
          ? [{ value: 'stable', label: 'Stable' }]
          : [
              { value: 'mps', label: 'Apple Silicon (MPS)', data: { variantId: 'mps' } },
              { value: 'cpu', label: 'CPU', data: { variantId: 'cpu' } }
            ]
      )
    }
  }

  it('lays the snapshot out as form rows with the same Hardware dropdown as New build', async () => {
    installApi()
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await wrapper.get('.load-snapshot-tertiary').trigger('click')
    await flushPromises()

    expect(
      wrapper
        .findAll('.config-label')
        .map((label) => label.text())
        .slice(0, 5)
    ).toEqual(['Snapshot file', 'Name', 'Release', 'Hardware', 'Contents'])
    expect(wrapper.find('.setup-option').exists()).toBe(false)
    const hardware = wrapper
      .findAllComponents(BaseSelect)
      .find((select) => select.props('ariaLabel') === 'Hardware')!
    expect(hardware.props('modelValue')).toBe('mps')
    expect(hardware.props('options').map((option) => option.label)).toEqual([
      'CPU',
      'Apple Silicon (MPS)'
    ])

    hardware.vm.$emit('update:modelValue', 'cpu')
    await flushPromises()
    expect(hardware.props('modelValue')).toBe('cpu')
    const create = wrapper.get('.load-snapshot-create')
    expect(create.text()).toBe('Create build')
    expect(create.attributes('disabled')).toBeUndefined()
  })

  it('swaps the snapshot from its file row instead of a Back button', async () => {
    installApi()
    const api = (window as unknown as { api: Record<string, ReturnType<typeof vi.fn>> }).api
    api.revealPath = vi.fn()
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()
    await wrapper.get('.load-snapshot-tertiary').trigger('click')
    await flushPromises()

    const fileRow = wrapper.get('.load-snapshot-file')
    await fileRow.get('button.config-path-open').trigger('click')
    expect(api.revealPath).toHaveBeenCalledWith('/tmp/snap.json')

    await fileRow.get('.config-path-browse').trigger('click')
    await flushPromises()
    expect(api.previewSnapshotFile).toHaveBeenCalledTimes(2)
  })

  it('keeps the snapshot while Create build is running', async () => {
    installApi()
    const api = (window as unknown as { api: Record<string, ReturnType<typeof vi.fn>> }).api
    api.createFromSnapshot = vi.fn(() => new Promise(() => {}))
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()
    await wrapper.get('.load-snapshot-tertiary').trigger('click')
    await flushPromises()

    await wrapper.get('.load-snapshot-create').trigger('click')
    await flushPromises()
    await wrapper.get('.load-snapshot-file .config-path-browse').trigger('click')
    await flushPromises()

    expect(api.previewSnapshotFile).toHaveBeenCalledTimes(1)
  })

  it('hides folded snapshot lists from assistive technology', async () => {
    installApi()
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()
    await wrapper.get('.load-snapshot-tertiary').trigger('click')
    await flushPromises()

    const wraps = wrapper.findAll('.load-snapshot-disclosure__wrap')
    expect(wraps.map((wrap) => wrap.attributes('aria-hidden'))).toEqual(['true', 'true', 'true'])
    expect(wraps.map((wrap) => wrap.attributes('inert') !== undefined)).toEqual([true, true, true])

    await wrapper.findAll('.load-snapshot-disclosure__summary')[0].trigger('click')
    expect(wraps[0].attributes('aria-hidden')).toBe('false')
    expect(wraps[0].attributes('inert')).toBeUndefined()
  })

  it('keeps an empty Custom nodes list folded and opens it when the snapshot has nodes', async () => {
    installApi()
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()
    await wrapper.get('.load-snapshot-tertiary').trigger('click')
    await flushPromises()

    const nodes = wrapper.findAll('.load-snapshot-disclosure')[0]
    expect(nodes.text()).toContain('Custom nodes (0)')
    expect(nodes.classes()).not.toContain('is-open')

    const withNodes = {
      ...preview,
      newestSnapshot: {
        ...preview.newestSnapshot,
        customNodes: [{ id: 'comfyui-impact-pack', type: 'cnr', enabled: true, version: '1.0.0' }]
      }
    }
    const api = (window as unknown as { api: Record<string, ReturnType<typeof vi.fn>> }).api
    api.previewSnapshotFile.mockResolvedValueOnce({ ok: true, preview: withNodes })
    await wrapper.get('.load-snapshot-file .config-path-browse').trigger('click')
    await flushPromises()

    const reopened = wrapper.findAll('.load-snapshot-disclosure')[0]
    expect(reopened.text()).toContain('Custom nodes (1)')
    expect(reopened.classes()).toContain('is-open')
  })
})
