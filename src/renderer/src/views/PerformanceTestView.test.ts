import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PerformanceTestView from './PerformanceTestView.vue'

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ isSignedIn: false })
}))
vi.mock('../stores/installationStore', () => ({
  useInstallationStore: () => ({ installations: [] })
}))
vi.mock('../stores/sessionStore', () => ({
  useSessionStore: () => ({ getSession: vi.fn(), isLaunching: vi.fn(), isRunning: vi.fn() })
}))
vi.mock('../composables/useWorkspaceInstallScope', async () => {
  const { ref } = await import('vue')
  return {
    useWorkspaceInstallScope: () => ({
      selectedWorkspaceId: ref(null),
      scopedInstallations: ref([])
    })
  }
})

function mountView() {
  return mount(PerformanceTestView, {
    global: {
      stubs: {
        BrandBackground: { template: '<div><slot /></div>' },
        BrandedPageHeader: true,
        InfoTooltip: true,
        TemplatePickerStep: true,
        BaseModal: true
      }
    }
  })
}

beforeEach(() => {
  window.api = new Proxy(
    {},
    {
      get: (_, method) =>
        String(method).startsWith('on')
          ? vi.fn(() => vi.fn())
          : vi.fn().mockResolvedValue(undefined)
    }
  ) as unknown as typeof window.api
})

describe('PerformanceTestView run counts', () => {
  it.each([
    ['performance-test-warmup-runs', '9', '5'],
    ['performance-test-measured-runs', '500', '100'],
    ['performance-test-warmup-runs', '', '1'],
    ['performance-test-measured-runs', '0', '1']
  ])('corrects %s from "%s" to "%s" on commit', async (id, entered, corrected) => {
    const field = mountView().get<HTMLInputElement>(`#${id}`)

    await field.setValue(entered)
    await field.trigger('change')

    expect(field.element.value).toBe(corrected)
  })

  it('repaints a value that normalizes back to the current model in one update', async () => {
    const field = mountView().get<HTMLInputElement>('#performance-test-measured-runs')
    await field.setValue('100')
    await field.trigger('change')

    field.element.value = '500'
    void field.trigger('input')
    void field.trigger('change')
    await nextTick()

    expect(field.element.value).toBe('100')
  })
})

describe('PerformanceTestView example workflow picker', () => {
  function mountWithPicker() {
    return mount(PerformanceTestView, {
      global: {
        stubs: {
          BrandBackground: { template: '<div><slot /></div>' },
          BrandedPageHeader: true,
          InfoTooltip: true,
          TemplatePickerStep: true,
          BaseModal: {
            name: 'BaseModal',
            props: { open: Boolean, closeOutside: Boolean },
            template:
              '<div data-testid="picker-modal"><slot name="header" /><slot /><footer><slot name="footer" /></footer></div>'
          }
        }
      }
    })
  }

  it('closes with the round button outside the card and keeps one action in the footer', () => {
    const wrapper = mountWithPicker()
    const modal = wrapper.getComponent({ name: 'BaseModal' })

    expect(modal.props('closeOutside')).toBe(true)
    const footerButtons = modal.findAll('footer button')
    expect(footerButtons).toHaveLength(1)
    expect(footerButtons[0]!.attributes('data-testid')).toBe('performance-test-use-example')
  })
})
