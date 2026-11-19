import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PerformanceTestView from './PerformanceTestView.vue'
import PerformanceTestBuildMenu from './performanceTest/PerformanceTestBuildMenu.vue'
import PerformanceTestWorkflowMenu from './performanceTest/PerformanceTestWorkflowMenu.vue'
import Tooltip from '../components/ui/Tooltip.vue'

const scopedInstallations = vi.hoisted(() => ({ value: [] as unknown[] }))

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
      scopedInstallations: ref(scopedInstallations.value)
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
  scopedInstallations.value = []
  const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>()
  window.api = new Proxy(
    {},
    {
      get: (_, method) => {
        if (!methods.has(method)) {
          methods.set(
            method,
            String(method).startsWith('on')
              ? vi.fn(() => vi.fn())
              : vi.fn().mockResolvedValue(undefined)
          )
        }
        return methods.get(method)
      }
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

describe('PerformanceTestView Run reason', () => {
  function runReason(wrapper: ReturnType<typeof mountView>) {
    const tooltip = wrapper
      .findAllComponents(Tooltip)
      .find((c) => c.find('.performance-test__run').exists())
    return tooltip?.props('text')
  }

  it('says to pick a build while none is picked', () => {
    const wrapper = mountView()

    expect(wrapper.get('.performance-test__run').attributes('disabled')).toBeDefined()
    expect(runReason(wrapper)).toBe('Select a build first.')
  })

  it('says to choose a workflow once a build is picked', async () => {
    scopedInstallations.value = [
      { id: 'b1', name: 'Build 1', sourceCategory: 'local', status: 'installed' }
    ]
    const wrapper = mountView()
    wrapper.getComponent(PerformanceTestBuildMenu).vm.$emit('update:modelValue', 'b1')
    await nextTick()

    expect(wrapper.get('.performance-test__run').attributes('disabled')).toBeDefined()
    expect(runReason(wrapper)).toBe('Choose a workflow first.')
  })

  it('says to wait, not to choose, while the first imported workflow is copied in', async () => {
    scopedInstallations.value = [
      { id: 'b1', name: 'Build 1', sourceCategory: 'local', status: 'installed' }
    ]
    vi.mocked(window.api.importPerformanceTestWorkflow).mockReturnValue(new Promise(() => {}))
    const wrapper = mountView()
    wrapper.getComponent(PerformanceTestBuildMenu).vm.$emit('update:modelValue', 'b1')
    wrapper.getComponent(PerformanceTestWorkflowMenu).vm.$emit('import')
    await nextTick()

    expect(wrapper.get('.performance-test__run').attributes('disabled')).toBeDefined()
    expect(runReason(wrapper)).toBe('Wait for the workflow to be ready.')
  })

  function runWrap(wrapper: ReturnType<typeof mountView>) {
    return wrapper.get('.performance-test__run').element.closest('.tooltip-wrap')!
  }

  it('lets keyboard users reach the reason while Run is blocked', () => {
    const wrapper = mountView()

    expect(runWrap(wrapper).getAttribute('tabindex')).toBe('0')
  })

  it('drops the extra tab stop once Run is available', async () => {
    scopedInstallations.value = [
      { id: 'b1', name: 'Build 1', sourceCategory: 'local', status: 'installed' }
    ]
    vi.mocked(window.api.importPerformanceTestWorkflow).mockResolvedValue({
      ok: true,
      filePath: '/workflows/flow.json'
    } as Awaited<ReturnType<typeof window.api.importPerformanceTestWorkflow>>)
    const wrapper = mountView()
    wrapper.getComponent(PerformanceTestBuildMenu).vm.$emit('update:modelValue', 'b1')
    wrapper.getComponent(PerformanceTestWorkflowMenu).vm.$emit('import')
    await flushPromises()

    expect(wrapper.get('.performance-test__run').attributes('disabled')).toBeUndefined()
    expect(runWrap(wrapper).hasAttribute('tabindex')).toBe(false)
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

  it('says to wait, not to choose, while the picked example is being prepared', async () => {
    scopedInstallations.value = [
      { id: 'b1', name: 'Build 1', sourceCategory: 'local', status: 'installed' }
    ]
    vi.mocked(window.api.getPerformanceTestExampleWorkflows).mockResolvedValue({
      options: [{ value: 'flux', label: 'Flux', recommended: true }],
      diskSpace: null
    } as unknown as Awaited<ReturnType<typeof window.api.getPerformanceTestExampleWorkflows>>)
    vi.mocked(window.api.preparePerformanceTestExampleWorkflow).mockReturnValue(
      new Promise(() => {})
    )
    const wrapper = mountWithPicker()
    wrapper.getComponent(PerformanceTestBuildMenu).vm.$emit('update:modelValue', 'b1')
    await nextTick()
    wrapper.getComponent(PerformanceTestWorkflowMenu).vm.$emit('choose-example')
    await flushPromises()
    await wrapper.get('[data-testid="performance-test-use-example"]').trigger('click')
    await nextTick()

    const runTooltip = wrapper
      .findAllComponents(Tooltip)
      .find((c) => c.find('.performance-test__run').exists())
    expect(wrapper.get('.performance-test__run').attributes('disabled')).toBeDefined()
    expect(runTooltip?.props('text')).toBe('Wait for the workflow to be ready.')
  })
})
