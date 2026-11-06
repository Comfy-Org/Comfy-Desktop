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
        DevPlatformAccountChip: true,
        DevPlatformWorkspaceSelector: true,
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
