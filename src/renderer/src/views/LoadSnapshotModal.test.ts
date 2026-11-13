import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import LoadSnapshotModal from './LoadSnapshotModal.vue'

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

  it('lays the snapshot out as form rows with the device as option cards', async () => {
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
    ).toEqual(['Snapshot file', 'Name', 'Release', 'Device', 'Contents'])
    const card = (label: string) =>
      wrapper
        .findAll('.setup-option')
        .find((option) => option.get('.setup-option__label').text() === label)!
    expect(card('Apple Silicon (MPS)').attributes('aria-checked')).toBe('true')

    await card('CPU').trigger('click')
    expect(card('CPU').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('.load-snapshot-create').text()).toBe('Create build')
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

    expect(wrapper.find('.load-snapshot-back').exists()).toBe(false)
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
    expect(wraps.map((wrap) => wrap.attributes('aria-hidden'))).toEqual(['false', 'true', 'true'])
    expect(wraps.map((wrap) => wrap.attributes('inert') !== undefined)).toEqual([false, true, true])
  })
})
