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
        .slice(0, 4)
    ).toEqual(['Name', 'Release', 'Device', 'Source build'])
    const card = (label: string) =>
      wrapper
        .findAll('.setup-option')
        .find((option) => option.get('.setup-option__label').text() === label)!
    expect(card('Apple Silicon (MPS)').attributes('aria-checked')).toBe('true')

    await card('CPU').trigger('click')
    expect(card('CPU').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('.load-snapshot-create').text()).toBe('Create build')
  })
})
