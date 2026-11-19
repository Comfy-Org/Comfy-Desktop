import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import QuickInstallModal from './QuickInstallModal.vue'
import { useModal } from '../composables/useModal'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toVariantBucket: vi.fn(() => 'cpu'),
  toErrorBucket: vi.fn(() => 'other')
}))

function stubApi(addResult: Record<string, unknown>): void {
  window.api = {
    getDefaultInstallDir: vi.fn().mockResolvedValue('/home/user/ComfyUI'),
    getSources: vi.fn().mockResolvedValue([{ id: 'standalone', label: 'Standalone', fields: [] }]),
    detectGPU: vi.fn().mockResolvedValue(null),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getFieldOptions: vi.fn(async (_source: string, field: string) =>
      field === 'release'
        ? [{ value: 'stable', label: 'Stable' }]
        : [{ value: 'cpu', label: 'CPU', recommended: true, data: { variantId: 'cpu' } }]
    ),
    getDiskSpace: vi.fn().mockResolvedValue(null),
    validateInstallPath: vi.fn().mockResolvedValue([]),
    buildInstallation: vi.fn().mockResolvedValue({ sourceId: 'standalone' }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    addInstallation: vi.fn().mockResolvedValue(addResult),
    browseFolder: vi.fn().mockResolvedValue('/home/user/Picked'),
    openPath: vi.fn()
  } as unknown as typeof window.api
}

async function failToInstall(addResult: Record<string, unknown>) {
  stubApi(addResult)
  const wrapper = mount(QuickInstallModal, {
    global: {
      stubs: {
        ModalShell: {
          template: '<div><slot name="header" /><slot /><slot name="footer" /></div>'
        }
      }
    }
  })
  await flushPromises()
  await (wrapper.vm as unknown as { open: () => Promise<void> }).open()
  await flushPromises()
  await wrapper.get('.quick-install-button').trigger('click')
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  useModal().dismiss()
})

describe('QuickInstallModal, when the build cannot be added', () => {
  it('offers Change location for a folder problem and opens the location picker', async () => {
    const wrapper = await failToInstall({
      ok: false,
      message: 'That directory is already used by "Studio".',
      reason: 'location'
    })
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    expect(modal.state.buttonLabel).toBe('Change location')

    modal.close(true)
    await flushPromises()

    expect(window.api.browseFolder).toHaveBeenCalledExactlyOnceWith('/home/user/ComfyUI')
    expect(window.api.addInstallation).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('show-progress')).toBeUndefined()
    expect(wrapper.get('.quick-install-button').attributes('disabled')).toBeUndefined()
  })

  it('shows any other failure with a single OK that only closes', async () => {
    await failToInstall({ ok: false, message: 'Disk is read-only.' })
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    expect(modal.state.message).toBe('Disk is read-only.')
    expect(modal.state.buttonLabel).toBe('OK')

    modal.close(true)
    await flushPromises()

    expect(window.api.browseFolder).not.toHaveBeenCalled()
  })
})
