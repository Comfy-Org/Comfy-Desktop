import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import BaseModal from './ui/BaseModal.vue'
import BaseAlert from './ui/BaseAlert.vue'
import ModalDialog from './ModalDialog.vue'
import SetupModal from './SetupModal.vue'
import AnnouncementModal from './AnnouncementModal.vue'
import WhyTryCloudModal from './WhyTryCloudModal.vue'
import BuildProgressDialog from '../panel/BuildProgressDialog.vue'
import { useModal } from '../composables/useModal'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  emitTelemetryEvent: vi.fn()
}))

const mounted: VueWrapper[] = []

afterEach(() => {
  useModal().dismiss()
  mounted.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

async function backdropOf(mountIt: () => VueWrapper, overlaySelector: string): Promise<string> {
  mounted.push(mountIt())
  await flushPromises()
  const overlay = document.querySelector(overlaySelector)
  if (!overlay) throw new Error(`missing ${overlaySelector}`)
  const color = getComputedStyle(overlay).backgroundColor
  mounted.splice(0).forEach((w) => w.unmount())
  useModal().dismiss()
  await flushPromises()
  document.body.innerHTML = ''
  return color
}

describe('modal backdrops', () => {
  it('dim the page behind every modal with one tone', async () => {
    document.documentElement.dataset.theme = 'dark'
    window.api = new Proxy(
      {},
      {
        get: (_, method) =>
          String(method).startsWith('on')
            ? vi.fn(() => vi.fn())
            : vi.fn().mockResolvedValue(undefined)
      }
    ) as unknown as typeof window.api
    setActivePinia(createPinia())
    const tones = {
      baseModal: await backdropOf(
        () => mount(BaseModal, { attachTo: document.body, props: { open: true, ariaLabel: 'M' } }),
        '.base-modal-overlay'
      ),
      baseAlert: await backdropOf(
        () =>
          mount(BaseAlert, {
            attachTo: document.body,
            props: { open: true, title: 'Alert', message: 'Something happened.' }
          }),
        '.base-alert-overlay'
      ),
      modalDialog: await backdropOf(() => {
        const wrapper = mount(ModalDialog, { attachTo: document.body })
        void useModal().prompt({ title: 'Name snapshot', message: '' })
        return wrapper
      }, '.dialog-overlay'),
      setupModal: await backdropOf(
        () => mount(SetupModal, { attachTo: document.body, props: { dialogLabel: 'Set up' } }),
        '.setup-modal-overlay'
      ),
      announcement: await backdropOf(
        () => mount(AnnouncementModal, { attachTo: document.body }),
        '.announce-overlay'
      ),
      whyCloud: await backdropOf(
        () => mount(WhyTryCloudModal, { attachTo: document.body }),
        '.why-cloud-overlay'
      ),
      buildProgress: await backdropOf(
        () =>
          mount(BuildProgressDialog, {
            attachTo: document.body,
            props: { installationId: 'missing' }
          }),
        '.build-progress-overlay'
      )
    }

    expect(tones.baseModal).not.toBe('rgba(0, 0, 0, 0)')
    for (const tone of Object.values(tones)) expect(tone).toBe(tones.baseModal)
  })
})
