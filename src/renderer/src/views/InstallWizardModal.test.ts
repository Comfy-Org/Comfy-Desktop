import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { en } from '../lib/i18nMessages.ts'
import InstallWizardModal from './InstallWizardModal.vue'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountModal() {
  return mount(InstallWizardModal, {
    global: {
      plugins: [makeI18n()],
      stubs: { BrandTakeoverLayout: { template: '<div><slot /></div>' } },
    },
  })
}

beforeEach(() => {
  window.api = {
    openPath: vi.fn().mockResolvedValue(undefined),
    browseFolder: vi.fn().mockResolvedValue('/home/user/Picked'),
    detectGPU: vi.fn().mockResolvedValue(null),
    getDefaultInstallDir: vi.fn().mockResolvedValue('/home/user/ComfyUI'),
    getSources: vi.fn().mockResolvedValue([]),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSetting: vi.fn().mockResolvedValue(false),
    getInstallationsSummary: vi.fn().mockResolvedValue({ localCount: 0 }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    getDiskSpace: vi.fn().mockResolvedValue(null),
    validateInstallPath: vi.fn().mockResolvedValue([]),
  } as unknown as typeof window.api
})

describe('InstallWizardModal install-location field', () => {
  it('renders the default install location as a clickable path that opens the folder', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    const pathBtn = wrapper.find('button.config-path-open')
    expect(pathBtn.exists()).toBe(true)
    expect(pathBtn.text()).toBe('/home/user/ComfyUI')

    await pathBtn.trigger('click')
    expect(window.api.openPath).toHaveBeenCalledWith('/home/user/ComfyUI')
  })

  it('renders a blank install location as inert (non-clickable, never opens a folder)', async () => {
    ;(window.api.getDefaultInstallDir as ReturnType<typeof vi.fn>).mockResolvedValue('')
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.find('button.config-path-open').exists()).toBe(false)
    expect(wrapper.find('.config-path-open--static').exists()).toBe(true)
    expect(window.api.openPath).not.toHaveBeenCalled()
  })
})

describe('InstallWizardModal onboarding→install handoff telemetry (#1224)', () => {
  interface HandoffEvent {
    actionName: string
    context?: Record<string, unknown>
  }

  function captureTelemetry(): { events: HandoffEvent[]; stop: () => void } {
    const events: HandoffEvent[] = []
    const listener = (e: Event): void => {
      events.push((e as CustomEvent<HandoffEvent>).detail)
    }
    window.addEventListener('launcher-telemetry-action', listener)
    return { events, stop: () => window.removeEventListener('launcher-telemetry-action', listener) }
  }

  it('emits install.not_started(wizard_cancelled) when the wizard unmounts without dispatching', async () => {
    const { events, stop } = captureTelemetry()
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: (o?: { entrypoint?: string }) => Promise<void> }).open({
      entrypoint: 'first_use'
    })
    await flushPromises()

    wrapper.unmount()
    stop()

    const notStarted = events.filter((e) => e.actionName === 'comfy.desktop.install.not_started')
    expect(notStarted).toHaveLength(1)
    expect(notStarted[0]!.context).toMatchObject({
      reason: 'wizard_cancelled',
      entrypoint: 'first_use',
      express: false
    })
  })
})
