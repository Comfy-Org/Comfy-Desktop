// How the GPU-aware Cloud recommendation interacts with the cloud
// capacity kill switch.
//
// Separate file because `useCloudCapacity` holds module-level singleton
// refs and caches its boot fetch, so a capacity value can only be chosen
// once per module instance. Same `vi.resetModules()` + dynamic-import
// approach `useCloudCapacity.test.ts` uses.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { CloudCapacityStatus, CloudUserTier } from '../types/ipc'
import type { GpuTier } from '../../../shared/gpuTier'

vi.mock('../lib/telemetry', () => ({ emitTelemetryAction: vi.fn() }))

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false
})

// Stubbed via mount options rather than `vi.mock` so the whole child set
// is one object. Only the three that carry start-screen content need a
// real template; `role="radio"` is reproduced because the view's arrow-key
// handler delegates off it.
const stubs = {
  TakeoverHeader: true,
  ModalShell: true,
  WhyTryCloudModal: true,
  TermsModal: true,
  BrandTakeoverLayout: { template: '<div><slot /></div>' },
  Tooltip: { template: '<span><slot /></span>' },
  ChoiceCard: {
    props: { selectable: Boolean, selected: Boolean, tabStop: Boolean },
    template:
      '<div :role="selectable ? \'radio\' : undefined" :data-selected="String(!!selected)" :data-tab-stop="String(!!tabStop)"><slot name="label-trailing" /><slot name="desc-trailing" /><slot /></div>'
  }
}

/** Mount a fresh component + capacity singleton at the given capacity. */
async function mountAt(opts: {
  capacity: CloudCapacityStatus
  tier?: CloudUserTier
  gpuTier?: GpuTier
}) {
  window.api = {
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(true),
    getLocale: vi.fn().mockResolvedValue('en'),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSystemInfo: vi
      .fn()
      .mockResolvedValue({ gpu_tier: opts.gpuTier ?? 'cpu_only', gpu_label: null }),
    getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(true),
    getCloudCapacity: vi.fn().mockResolvedValue(opts.capacity),
    getCloudUserTier: vi.fn().mockResolvedValue(opts.tier ?? 'unknown'),
    setFirstUseMode: vi.fn(),
    closeHostWindow: vi.fn().mockResolvedValue(undefined),
    telemetryGetExperimentFlag: vi.fn().mockResolvedValue(undefined),
    telemetryRecordExposure: vi.fn()
  } as unknown as typeof window.api

  vi.resetModules()
  const FirstUseTakeover = (await import('./FirstUseTakeover.vue')).default
  const wrapper = mount(FirstUseTakeover, { global: { plugins: [i18n], stubs } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Cloud recommendation vs. capacity kill switch', () => {
  it('goes quiet entirely when Cloud is capacity-disabled', async () => {
    const wrapper = await mountAt({ capacity: 'disabled' })
    // The card is aria-disabled and pointer-events:none in this state, so
    // recommending it — and advertising free runs on it — points the user
    // at something they physically cannot click. No-preselect would
    // strand them too: the only recommended option is unselectable.
    expect(wrapper.find('[data-testid="first-use-cloud-reco"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="first-use-cloud-runs-pill"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  it('leaves exactly one card Tab-reachable when Cloud is capacity-disabled', async () => {
    const wrapper = await mountAt({ capacity: 'disabled' })
    // ChoiceCard takes tabindex 0 when it is `selected` OR holds `tabStop`,
    // so reachability is the union. The invariant the group must never
    // violate is one reachable member — zero drops the radiogroup out of
    // the tab order, and this is the branch `keyboardEntryChoice` flips to
    // Local for.
    const reachable = wrapper
      .findAll('[data-testid="first-use-pick-cloud"], [data-testid="first-use-pick-local"]')
      .filter(
        (c) => c.attributes('data-selected') === 'true' || c.attributes('data-tab-stop') === 'true'
      )
    expect(reachable).toHaveLength(1)
    expect(reachable[0]?.attributes('data-testid')).toBe('first-use-pick-local')
  })

  it('arrow keys refuse to select a capacity-disabled Cloud card', async () => {
    const wrapper = await mountAt({ capacity: 'disabled' })
    await wrapper
      .find('[data-testid="first-use-pick-local"]')
      .trigger('keydown', { key: 'ArrowUp' })
    // Keyboard parity with the pointer path, which ignores the click.
    expect(wrapper.find('[data-testid="first-use-pick-cloud"]').attributes('data-selected')).toBe(
      'false'
    )
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  it('still recommends Cloud under degraded capacity', async () => {
    // `degraded` only warns on commit — Cloud is still bookable, so the
    // recommendation stands.
    const wrapper = await mountAt({ capacity: 'degraded' })
    expect(wrapper.find('[data-testid="first-use-cloud-reco"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="first-use-cloud-runs-pill"]').exists()).toBe(true)
  })

  it('keeps the badge but drops the pill for a device that has used Cloud', async () => {
    // The hardware recommendation is independent of prior Cloud usage;
    // the trial offer is not.
    const wrapper = await mountAt({ capacity: 'normal', tier: 'paid' })
    expect(wrapper.find('[data-testid="first-use-cloud-reco"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="first-use-cloud-runs-pill"]').exists()).toBe(false)
  })
})
