import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import QuickInstallModal from './QuickInstallModal.vue'
import { en } from '../lib/i18nMessages'

const alert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../composables/useModal', () => ({ useModal: () => ({ alert }) }))

describe('QuickInstallModal build results', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(async () => {
    vi.clearAllMocks()
    window.api = {
      getDefaultInstallDir: vi.fn().mockResolvedValue('/tmp/ComfyUI'),
      getSources: vi
        .fn()
        .mockResolvedValue([{ id: 'standalone', label: 'Standalone', fields: [] }]),
      detectGPU: vi.fn().mockResolvedValue(null),
      validateHardware: vi.fn().mockResolvedValue({ supported: true }),
      getFieldOptions: vi
        .fn()
        .mockImplementation(async (_source, field) =>
          field === 'release'
            ? [{ value: 'latest', label: 'Latest' }]
            : [{ value: 'cpu', label: 'CPU', data: { variantId: 'cpu' } }]
        ),
      getDiskSpace: vi.fn().mockResolvedValue(null),
      validateInstallPath: vi.fn().mockResolvedValue([]),
      buildInstallation: vi.fn(),
      getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
      addInstallation: vi
        .fn()
        .mockResolvedValue({ ok: true, entry: { id: 'new', name: 'ComfyUI' } })
    } as unknown as typeof window.api
    wrapper = mount(QuickInstallModal, {
      global: { stubs: { ModalShell: { template: '<div><slot /></div>' } } }
    })
    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
  })

  afterEach(() => wrapper.unmount())

  it('shows the localized validation message under Cannot Add and permits retry', async () => {
    vi.mocked(window.api.buildInstallation).mockResolvedValue({
      ok: false,
      message: en.standalone.invalidRuntime
    })
    await wrapper.get('.quick-install-btn').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: en.errors.cannotAdd,
      message: en.standalone.invalidRuntime
    })
    expect(window.api.addInstallation).not.toHaveBeenCalled()
    expect(wrapper.emitted('show-progress')).toBeUndefined()
    expect(wrapper.get<HTMLButtonElement>('.quick-install-btn').element.disabled).toBe(false)
  })

  it('passes successful build data to installation creation', async () => {
    const data = { sourceId: 'standalone', variant: 'cpu' }
    vi.mocked(window.api.buildInstallation).mockResolvedValue({ ok: true, data })
    await wrapper.get('.quick-install-btn').trigger('click')
    await flushPromises()

    expect(window.api.addInstallation).toHaveBeenCalledExactlyOnceWith({
      ...data,
      name: 'ComfyUI',
      installPath: '/tmp/ComfyUI',
      status: 'installing'
    })
    expect(alert).not.toHaveBeenCalled()
    expect(wrapper.emitted('show-progress')?.[0]?.[0]).toMatchObject({ installationId: 'new' })
  })
})
