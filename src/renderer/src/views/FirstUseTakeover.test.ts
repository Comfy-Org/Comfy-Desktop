import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setChecked } from './testHelpers'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn()
}))

vi.mock('../components/TakeoverHeader.vue', () => ({
  default: { template: '<div data-testid="stub-takeover-header"><slot /></div>' }
}))
vi.mock('../components/ModalShell.vue', () => ({
  default: { template: '<div data-testid="stub-modal-shell"><slot /></div>' }
}))
vi.mock('../components/ChoiceCard.vue', () => ({
  default: {
    props: {
      label: null,
      description: null,
      tagline: null,
      disabled: Boolean,
      glow: Boolean,
      selectable: Boolean,
      selected: Boolean,
      tabStop: Boolean
    },
    template:
      '<div :role="selectable ? \'radio\' : undefined" :data-selected="String(!!selected)" :data-tab-stop="String(!!tabStop)"><slot name="label-trailing" /><slot name="desc-trailing" /><slot /></div>'
  }
}))
vi.mock('../components/WhyTryCloudModal.vue', () => ({
  default: { template: '<div data-testid="stub-why-cloud" />' }
}))
vi.mock('../components/ui/Tooltip.vue', () => ({
  default: {
    name: 'Tooltip',
    props: ['text', 'side', 'align', 'delayMs', 'disabled'],
    template: '<span data-testid="stub-tooltip-wrap" :data-text="text"><slot /></span>'
  }
}))
vi.mock('../components/TermsModal.vue', () => ({
  default: {
    props: ['doc'],
    template: '<div data-testid="stub-terms-modal" :data-doc="doc" />'
  }
}))
vi.mock('../components/BrandTakeoverLayout.vue', () => ({
  default: {
    template: '<div data-testid="stub-brand-layout"><slot /></div>'
  }
}))

import FirstUseTakeover from './FirstUseTakeover.vue'
import { emitTelemetryAction } from '../lib/telemetry'
import type { GpuTier } from '../../../shared/gpuTier'

function systemInfo(
  tier: GpuTier,
  label: string | null = 'NVIDIA',
  hardware: { gpu_vendor?: string | null; gpu_vram_gb?: number | null } = {}
) {
  return { gpu_tier: tier, gpu_label: label, ...hardware }
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {}
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(emitTelemetryAction).mockClear()
  window.api = {
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(true),
    getLocale: vi.fn().mockResolvedValue('en'),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSystemInfo: vi.fn().mockResolvedValue(systemInfo('high')),
    getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(true),
    getCloudUserTier: vi.fn().mockResolvedValue('unknown'),
    setFirstUseMode: vi.fn(),
    closeHostWindow: vi.fn().mockResolvedValue(undefined),
    telemetryGetExperimentFlag: vi.fn().mockResolvedValue(undefined),
    telemetryRecordExposure: vi.fn()
  } as unknown as typeof window.api
})

function mountTakeover() {
  return mount(FirstUseTakeover)
}

describe('FirstUseTakeover start step', () => {
  it('names the takeover after the visible step heading', () => {
    const wrapper = mountTakeover()
    expect(wrapper.get('[data-testid="stub-brand-layout"]').attributes('aria-label')).toBe(
      wrapper.get('.first-use-title').text()
    )
  })

  it('Continue triggers a nudge shake on the ToS row when terms are not accepted', async () => {
    const wrapper = mountTakeover()
    const tosRow = wrapper.find('[data-testid="first-use-consent-tos"]')
    expect(tosRow.classes()).not.toContain('start-consent-row--nudge')

    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')
    expect(tosRow.classes()).toContain('start-consent-row--nudge')

    expect(wrapper.emitted('complete-cloud')).toBeFalsy()
    expect(wrapper.emitted('chain-local')).toBeFalsy()
  })

  it('clicking the EULA inline link opens the modal with doc="eula"', async () => {
    const wrapper = mountTakeover()
    await wrapper.find('[data-testid="first-use-eula-link"]').trigger('click')
    const modal = wrapper.find('[data-testid="stub-terms-modal"]')
    expect(modal.exists()).toBe(true)
    expect(modal.attributes('data-doc')).toBe('eula')
  })

  it('clicking the Terms of Service inline link opens the modal with doc="tos"', async () => {
    const wrapper = mountTakeover()
    await wrapper.find('[data-testid="first-use-tos-link"]').trigger('click')
    const modal = wrapper.find('[data-testid="stub-terms-modal"]')
    expect(modal.attributes('data-doc')).toBe('tos')
  })

  it('clicking the telemetry Learn-more opens the modal with doc="privacy"', async () => {
    const wrapper = mountTakeover()
    await wrapper.find('[data-testid="first-use-telemetry-learn-more"]').trigger('click')
    const modal = wrapper.find('[data-testid="stub-terms-modal"]')
    expect(modal.attributes('data-doc')).toBe('privacy')
  })

  it('Cloud (i) icon is wrapped in TooltipWrap carrying the whyTryCloud copy', () => {
    const wrapper = mountTakeover()
    const infoBtn = wrapper.find('[data-testid="first-use-why-cloud"]')
    expect(infoBtn.exists()).toBe(true)
    const tooltip = infoBtn.element.closest(
      '[data-testid="stub-tooltip-wrap"]'
    ) as HTMLElement | null
    expect(tooltip).not.toBeNull()
    expect(tooltip?.getAttribute('data-text')).toBe('Why try Cloud?')
  })

  it('Express-install checkbox is visible on the default Local pick and hides only when Cloud is picked', async () => {
    const wrapper = mountTakeover()
    await flushPromises()
    const express = () => wrapper.find('[data-testid="first-use-express-install"]')
    expect(express().exists()).toBe(true)
    expect(express().classes()).not.toContain('start-express--hidden')
    expect(express().attributes('aria-hidden')).toBe('false')

    await wrapper.find('[data-testid="first-use-pick-cloud"]').trigger('click')
    expect(express().classes()).toContain('start-express--hidden')
    expect(express().attributes('aria-hidden')).toBe('true')

    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    expect(express().classes()).not.toContain('start-express--hidden')
    expect(express().attributes('aria-hidden')).toBe('false')
  })

  it('emits `chain-local` with `express: false` when Local is picked and Express is left at its default-off state (no legacy desktop)', async () => {
    const wrapper = mountTakeover()
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    const emitted = wrapper.emitted('chain-local')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ express: false }])
  })

  it('emits `chain-local` with `express: true` when Express is explicitly ticked', async () => {
    const wrapper = mountTakeover()
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await setChecked(
      wrapper.find('[data-testid="first-use-express-install"] [role="checkbox"]'),
      true
    )
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    const emitted = wrapper.emitted('chain-local')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ express: true }])
  })

  it('hasLegacyDesktop + Express OFF + migrate OFF routes to the localBranch sub-step', async () => {
    const wrapper = mountTakeover()
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({
      hasLegacyDesktop: true
    })
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await setChecked(
      wrapper.find('[data-testid="first-use-migrate-existing"] [role="checkbox"]'),
      false
    )
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('chain-local')).toBeFalsy()
    expect(wrapper.find('[data-testid="first-use-local-migrate"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="stub-brand-layout"]').attributes('aria-label')).toBe(
      wrapper.get('.first-use-title').text()
    )
  })

  it('renders the "Migrate existing install" checkbox only when hasLegacyDesktop is true', async () => {
    const wrapper = mountTakeover()
    expect(wrapper.find('[data-testid="first-use-migrate-existing"]').exists()).toBe(false)
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({
      hasLegacyDesktop: true
    })
    expect(wrapper.find('[data-testid="first-use-migrate-existing"]').exists()).toBe(true)
  })

  it('routes Local + migrate-existing + Express to `chain-migrate` with express: true', async () => {
    const wrapper = mountTakeover()
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({
      hasLegacyDesktop: true
    })
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await setChecked(
      wrapper.find('[data-testid="first-use-express-install"] [role="checkbox"]'),
      true
    )
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    const emitted = wrapper.emitted('chain-migrate')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ express: true }])
    expect(wrapper.emitted('chain-local')).toBeFalsy()
    expect(wrapper.emitted('complete-cloud')).toBeFalsy()
    expect(wrapper.find('[data-testid="first-use-local-migrate"]').exists()).toBe(false)
  })

  it('routes Local + migrate-existing + Express OFF to `chain-migrate` with express: false (confirm surface still shown by host)', async () => {
    const wrapper = mountTakeover()
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({
      hasLegacyDesktop: true
    })
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await setChecked(
      wrapper.find('[data-testid="first-use-express-install"] [role="checkbox"]'),
      false
    )
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    const emitted = wrapper.emitted('chain-migrate')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ express: false }])
  })

  it('routes Local + Express + migrate-existing OFF to `chain-local` (fresh express install)', async () => {
    const wrapper = mountTakeover()
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({
      hasLegacyDesktop: true
    })
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await setChecked(
      wrapper.find('[data-testid="first-use-migrate-existing"] [role="checkbox"]'),
      false
    )
    await setChecked(
      wrapper.find('[data-testid="first-use-express-install"] [role="checkbox"]'),
      true
    )
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('chain-migrate')).toBeFalsy()
    const emitted = wrapper.emitted('chain-local')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ express: true }])
  })

  it('emits `complete-cloud` (not `chain-local`) when the user flips to Cloud and presses Continue', async () => {
    const wrapper = mountTakeover()
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-pick-cloud"]').trigger('click')
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('complete-cloud')).toBeTruthy()
    expect(wrapper.emitted('chain-local')).toBeFalsy()
  })

  it('Continue button switches to the loading copy + becomes disabled while Continue is in flight', async () => {
    const wrapper = mountTakeover()
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    const btn = wrapper.find('[data-testid="first-use-continue"]')
    expect(btn.text()).toBe('Continue')
    await btn.trigger('click')
    expect(btn.text()).toBe('Preparing your install…')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('aria-busy')).toBe('true')
  })

  it('open() resets the Continue spinner so the cancel-and-return path lands on a fresh CTA', async () => {
    const wrapper = mountTakeover()
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')
    const btnBusy = wrapper.find('[data-testid="first-use-continue"]')
    expect(btnBusy.text()).toBe('Preparing your install…')
    expect(btnBusy.attributes('disabled')).toBeDefined()

    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()

    const btnFresh = wrapper.find('[data-testid="first-use-continue"]')
    expect(btnFresh.text()).toBe('Continue')
    expect(btnFresh.attributes('disabled')).toBeUndefined()
    expect(btnFresh.attributes('aria-busy')).toBe('false')
  })

  it('closing the terms modal clears termsDoc (modal unmounts)', async () => {
    const wrapper = mountTakeover()
    await wrapper.find('[data-testid="first-use-eula-link"]').trigger('click')
    const stub = wrapper.findComponent('[data-testid="stub-terms-modal"]')
    expect(stub.exists()).toBe(true)

    await stub.vm.$emit('close')
    expect(wrapper.find('[data-testid="stub-terms-modal"]').exists()).toBe(false)
  })

  it('Continue without touching the picker routes to chain-local (Local is the default)', async () => {
    const wrapper = mountTakeover()
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('chain-local')).toBeTruthy()
    expect(wrapper.emitted('complete-cloud')).toBeFalsy()
  })
})

describe('FirstUseTakeover desktop-first-use-fork-default experiment', () => {
  it.each([
    ['Cloud', 'cloud' as const, undefined],
    ['Local', 'local' as const, 'cloud']
  ])(
    'preserves an explicit %s choice while boot defaults are still resolving',
    async (_label, choice, flagValue) => {
      const freeRuns = deferred<boolean>()
      ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue(
        flagValue
      )
      ;(window.api.getCloudFreeRunsEnabled as ReturnType<typeof vi.fn>).mockReturnValue(
        freeRuns.promise
      )
      const wrapper = mountTakeover()

      await wrapper.find(`[data-testid="first-use-pick-${choice}"]`).trigger('click')
      freeRuns.resolve(true)
      await flushPromises()

      expect(
        wrapper.find(`[data-testid="first-use-pick-${choice}"]`).attributes('data-selected')
      ).toBe('true')
    }
  )

  it('keeps Local as the default when the flag is missing (control / fallback)', async () => {
    const wrapper = mountTakeover()
    await flushPromises()

    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('chain-local')).toBeTruthy()
    expect(wrapper.emitted('complete-cloud')).toBeFalsy()
    expect(window.api.telemetryRecordExposure).toHaveBeenCalledWith({
      experimentKey: 'desktop-first-use-fork-default',
      variant: 'control',
      source: 'fallback'
    })
  })

  it("pre-selects Cloud when the flag returns 'cloud' (cloud-default arm) and fires exposure with source='cache'", async () => {
    ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue('cloud')
    const wrapper = mountTakeover()
    await flushPromises()

    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('complete-cloud')).toBeTruthy()
    expect(wrapper.emitted('chain-local')).toBeFalsy()
    expect(window.api.telemetryRecordExposure).toHaveBeenCalledWith({
      experimentKey: 'desktop-first-use-fork-default',
      variant: 'cloud-default',
      source: 'cache'
    })
  })

  it("pre-selects nothing when the flag returns 'none' (no-default arm) and disables Continue until a card is picked", async () => {
    ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue('none')
    const wrapper = mountTakeover()
    await flushPromises()

    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)

    const btn = wrapper.find('[data-testid="first-use-continue"]')
    expect(btn.attributes('disabled')).toBeDefined()

    await btn.trigger('click')
    expect(wrapper.emitted('chain-local')).toBeFalsy()
    expect(wrapper.emitted('complete-cloud')).toBeFalsy()

    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(wrapper.emitted('chain-local')).toBeTruthy()

    expect(window.api.telemetryRecordExposure).toHaveBeenCalledWith({
      experimentKey: 'desktop-first-use-fork-default',
      variant: 'no-default',
      source: 'cache'
    })
  })

  it("treats any other flag value ('control', unknown string, true) as control", async () => {
    ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue(
      'control'
    )
    const wrapper = mountTakeover()
    await flushPromises()
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')
    expect(wrapper.emitted('chain-local')).toBeTruthy()
    expect(window.api.telemetryRecordExposure).toHaveBeenCalledWith({
      experimentKey: 'desktop-first-use-fork-default',
      variant: 'control',
      source: 'cache'
    })
  })

  it('legacy-desktop precedence forces Local even when the cloud-default variant says Cloud', async () => {
    ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue('cloud')
    const wrapper = mountTakeover()
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({ hasLegacyDesktop: true })
    await flushPromises()

    expect(wrapper.find('[data-testid="first-use-migrate-existing"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="first-use-express-install"]').classes()).not.toContain(
      'start-express--hidden'
    )
  })

  it('legacy-desktop precedence forces Local even when the no-default variant says pick-nothing', async () => {
    ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue('none')
    const wrapper = mountTakeover()
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({ hasLegacyDesktop: true })
    await flushPromises()

    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    const btn = wrapper.find('[data-testid="first-use-continue"]')
    expect(btn.attributes('disabled')).toBeUndefined()

    expect(wrapper.find('[data-testid="first-use-migrate-existing"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="first-use-express-install"]').classes()).not.toContain(
      'start-express--hidden'
    )

    await btn.trigger('click')
    expect(wrapper.emitted('chain-migrate')).toBeTruthy()
  })
})

describe('FirstUseTakeover hardware warning', () => {
  const KFD_WARNING =
    'Your user cannot access the AMD GPU compute interface (/dev/kfd), so ComfyUI will not be able to use the GPU.'

  it('renders the validateHardware warning under the Local pick', async () => {
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: true,
      warning: KFD_WARNING
    })
    const wrapper = mountTakeover()
    await flushPromises()

    const warning = wrapper.find('[data-testid="first-use-hardware-warning"]')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toBe(KFD_WARNING)
  })

  it('hides the warning when Cloud is picked', async () => {
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: true,
      warning: KFD_WARNING
    })
    const wrapper = mountTakeover()
    await flushPromises()

    await wrapper.find('[data-testid="first-use-pick-cloud"]').trigger('click')
    expect(wrapper.find('[data-testid="first-use-hardware-warning"]').exists()).toBe(false)
  })

  it('renders no warning element when validateHardware reports none', async () => {
    const wrapper = mountTakeover()
    await flushPromises()
    expect(wrapper.find('[data-testid="first-use-hardware-warning"]').exists()).toBe(false)
  })

  it('discards a stale validateHardware result that resolves after a reopen', async () => {
    let resolveFirst!: (v: { supported: boolean; warning?: string }) => void
    const first = new Promise<{ supported: boolean; warning?: string }>((r) => {
      resolveFirst = r
    })
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(first)
      .mockResolvedValue({ supported: true })
    const wrapper = mountTakeover()
    await flushPromises()

    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    resolveFirst({ supported: true, warning: KFD_WARNING })
    await flushPromises()
    expect(wrapper.find('[data-testid="first-use-hardware-warning"]').exists()).toBe(false)
  })
})

describe('FirstUseTakeover GPU-aware Cloud recommendation', () => {
  const badge = (w: ReturnType<typeof mountTakeover>) =>
    w.find('[data-testid="first-use-cloud-reco"]')
  const pill = (w: ReturnType<typeof mountTakeover>) =>
    w.find('[data-testid="first-use-cloud-runs-pill"]')
  const cards = (w: ReturnType<typeof mountTakeover>) =>
    w.findAll('[data-testid="first-use-pick-cloud"], [data-testid="first-use-pick-local"]')

  async function mountWithTier(tier: GpuTier, label: string | null = 'NVIDIA') {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
      systemInfo(tier, label)
    )
    const wrapper = mountTakeover()
    await flushPromises()
    return wrapper
  }

  it.each<GpuTier>(['cpu_only', 'sub_low'])('recommends Cloud on the %s tier', async (tier) => {
    expect(badge(await mountWithTier(tier)).exists()).toBe(true)
  })

  it('exposes the recommendation reason as the Cloud radio description', async () => {
    const wrapper = await mountWithTier('cpu_only', null)
    const cloudCard = wrapper.find('[data-testid="first-use-pick-cloud"]')
    const reasonId = cloudCard.attributes('aria-describedby')

    expect(reasonId).toBe('first-use-cloud-reco-reason')
    expect(wrapper.find(`#${reasonId}`).text()).toBe(
      "This device doesn't have a GPU powerful enough for most workflows. Cloud runs them on hosted GPUs instead."
    )
  })

  it.each<GpuTier>(['high', 'mid', 'low', 'apple'])('leaves the %s tier alone', async (tier) => {
    const wrapper = await mountWithTier(tier)
    expect(badge(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  it('fails closed when the system-info IPC rejects', async () => {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'))
    const wrapper = mountTakeover()
    await flushPromises()
    expect(badge(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  it.each([
    ['nvidia' as const, 'a discrete NVIDIA card'],
    ['amd' as const, 'a discrete AMD card']
  ])('stays quiet when VRAM is unreadable on %s', async (vendor) => {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
      systemInfo('cpu_only', 'NVIDIA', { gpu_vendor: vendor, gpu_vram_gb: null })
    )
    const wrapper = mountTakeover()
    await flushPromises()
    expect(badge(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  it('still recommends when there is genuinely no GPU vendor', async () => {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
      systemInfo('cpu_only', null, { gpu_vendor: null, gpu_vram_gb: null })
    )
    const wrapper = mountTakeover()
    await flushPromises()
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('still recommends a discrete card whose VRAM really is small', async () => {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
      systemInfo('sub_low', 'NVIDIA', { gpu_vendor: 'nvidia', gpu_vram_gb: 4 })
    )
    const wrapper = mountTakeover()
    await flushPromises()
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('pre-selects neither card, gates Continue, and stays keyboard-reachable', async () => {
    const wrapper = await mountWithTier('cpu_only', null)
    for (const card of cards(wrapper)) expect(card.attributes('data-selected')).toBe('false')
    expect(cards(wrapper).filter((c) => c.attributes('data-tab-stop') === 'true')).toHaveLength(1)
    expect(wrapper.find('[data-testid="first-use-pick-cloud"]').attributes('data-tab-stop')).toBe(
      'true'
    )
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    expect(wrapper.find('[data-testid="first-use-continue"]').attributes('disabled')).toBeDefined()
  })

  it('arrow keys enter the group when nothing is selected', async () => {
    const wrapper = await mountWithTier('cpu_only', null)
    await wrapper
      .find('[data-testid="first-use-pick-cloud"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('[data-testid="first-use-pick-cloud"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  it('preserves an explicit Local click made before the tier resolves', async () => {
    let resolveInfo: (v: unknown) => void = () => {}
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((r) => {
        resolveInfo = r
      })
    )
    const wrapper = mountTakeover()
    await flushPromises()

    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )

    resolveInfo(systemInfo('cpu_only', null))
    await flushPromises()
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('hides the pill when free tier is off, leaving the recommendation alone', async () => {
    ;(window.api.getCloudFreeRunsEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const wrapper = await mountWithTier('cpu_only', null)
    expect(pill(wrapper).exists()).toBe(false)
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('keeps the recommendation but hides the trial pill for a returning cloud user', async () => {
    ;(window.api.getCloudUserTier as ReturnType<typeof vi.fn>).mockResolvedValue('paid')
    const wrapper = await mountWithTier('cpu_only', null)
    expect(pill(wrapper).exists()).toBe(false)
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('fails closed when the free-runs IPC rejects', async () => {
    ;(window.api.getCloudFreeRunsEnabled as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('nope')
    )
    expect(pill(await mountWithTier('cpu_only', null)).exists()).toBe(false)
  })

  it('reuses one system-info request across open() replays', async () => {
    const wrapper = await mountWithTier('cpu_only', null)
    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    expect(window.api.getSystemInfo).toHaveBeenCalledTimes(1)
  })
})

describe('FirstUseTakeover recommendation telemetry', () => {
  async function commitWith(tier: GpuTier, pick: 'cloud' | 'local') {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
      systemInfo(tier, null)
    )
    const wrapper = mountTakeover()
    await flushPromises()
    await wrapper.find(`[data-testid="first-use-pick-${pick}"]`).trigger('click')
    await setChecked(wrapper.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  function forkChosenProps() {
    const call = vi
      .mocked(emitTelemetryAction)
      .mock.calls.find(([name]) => name === 'comfy.desktop.first_use.fork_chosen')
    return call?.[1] as Record<string, unknown> | undefined
  }

  it.each([
    ['cpu_only' as GpuTier, 'cloud' as const, true],
    ['high' as GpuTier, 'local' as const, false]
  ])('tags fork_chosen on %s with reco_shown=%s', async (tier, pick, shown) => {
    await commitWith(tier, pick)
    expect(forkChosenProps()).toMatchObject({ choice: pick, reco_shown: shown, gpu_tier: tier })
  })

  it.each([
    ['cpu_only' as GpuTier, false],
    ['high' as GpuTier, true]
  ])('records fork-default exposure on %s: %s', async (tier, recorded) => {
    ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue('cloud')
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
      systemInfo(tier, null)
    )
    mountTakeover()
    await flushPromises()
    const call = vi.mocked(window.api.telemetryRecordExposure).mock.calls.length > 0
    expect(call).toBe(recorded)
    if (recorded) {
      expect(window.api.telemetryRecordExposure).toHaveBeenCalledWith(
        expect.objectContaining({
          experimentKey: 'desktop-first-use-fork-default',
          variant: 'cloud-default'
        })
      )
    }
  })
})

describe('FirstUseTakeover beta-features opt-in', () => {
  type Wrapper = ReturnType<typeof mountTakeover>

  async function openWith(persisted: Record<string, unknown>): Promise<Wrapper> {
    vi.mocked(window.api.getSetting).mockImplementation(async (key: string) => persisted[key])
    const wrapper = mountTakeover()
    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    return wrapper
  }

  const betaRow = (w: Wrapper) => w.find('[data-testid="first-use-consent-beta"]')
  const betaBox = (w: Wrapper) => w.find('[data-testid="first-use-consent-beta"] [role="checkbox"]')
  const telemetryBox = (w: Wrapper) =>
    w.find('[data-testid="first-use-consent-telemetry"] [role="checkbox"]')
  const isChecked = (el: ReturnType<typeof betaBox>) => el.attributes('aria-checked') === 'true'

  it('mirrors the telemetry choice until the user touches it, then diverges', async () => {
    const w = await openWith({ telemetryEnabled: true })
    expect(isChecked(betaBox(w))).toBe(true)

    await setChecked(telemetryBox(w), false)
    expect(isChecked(betaBox(w))).toBe(false)
    expect(betaBox(w).attributes('aria-readonly')).toBe('true')

    await setChecked(telemetryBox(w), true)
    expect(isChecked(betaBox(w))).toBe(true)

    await setChecked(betaBox(w), false)
    expect(isChecked(betaBox(w))).toBe(false)
    expect(isChecked(telemetryBox(w))).toBe(true)
  })

  it('never re-enables a touched toggle when telemetry is switched back on', async () => {
    const w = await openWith({ telemetryEnabled: true })
    await setChecked(betaBox(w), false)
    await setChecked(betaBox(w), true)
    expect(isChecked(betaBox(w))).toBe(true)

    await setChecked(telemetryBox(w), false)
    expect(isChecked(betaBox(w))).toBe(false)

    await setChecked(telemetryBox(w), true)
    expect(isChecked(betaBox(w))).toBe(false)
  })

  it('replays a persisted opt-out unchanged through a telemetry off/on cycle', async () => {
    const w = await openWith({ telemetryEnabled: true, betaFeaturesEnabled: false })
    expect(isChecked(betaBox(w))).toBe(false)
    expect(isChecked(telemetryBox(w))).toBe(true)

    await setChecked(telemetryBox(w), false)
    expect(isChecked(betaBox(w))).toBe(false)

    await setChecked(telemetryBox(w), true)
    expect(isChecked(betaBox(w))).toBe(false)
  })

  it('replays a persisted opt-in', async () => {
    const w = await openWith({ telemetryEnabled: true, betaFeaturesEnabled: true })
    expect(isChecked(betaBox(w))).toBe(true)
  })

  it('preserves a persisted opt-in when telemetry is off and persists it on replay', async () => {
    const w = await openWith({ telemetryEnabled: false, betaFeaturesEnabled: true })
    expect(isChecked(betaBox(w))).toBe(true)

    await (w.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    expect(isChecked(betaBox(w))).toBe(true)

    await setChecked(w.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await w.find('[data-testid="first-use-pick-local"]').trigger('click')
    await w.find('[data-testid="first-use-continue"]').trigger('click')
    await flushPromises()
    expect(window.api.setSetting).toHaveBeenCalledWith('betaFeaturesEnabled', true)
  })

  it('allows a preserved persisted opt-in to be explicitly opted out', async () => {
    const w = await openWith({ telemetryEnabled: false, betaFeaturesEnabled: true })
    await setChecked(betaBox(w), false)
    expect(isChecked(betaBox(w))).toBe(false)
  })

  it('revokes a new unpersisted opt-in when telemetry is switched off', async () => {
    const w = await openWith({ telemetryEnabled: true })
    expect(isChecked(betaBox(w))).toBe(true)

    await setChecked(telemetryBox(w), false)
    expect(isChecked(betaBox(w))).toBe(false)
  })

  it('keeps the checkbox focusable and blocks activation without telemetry', async () => {
    const w = await openWith({ telemetryEnabled: false })
    const box = betaBox(w)
    const reasonId = box.attributes('aria-describedby')
    expect(box.attributes('disabled')).toBeUndefined()
    expect(box.attributes('aria-readonly')).toBe('true')
    expect(reasonId).toBeTruthy()
    expect(w.find(`#${reasonId}`).text()).toBe(
      'Beta features require confirming data sharing in Settings, even if telemetry is currently on.'
    )
    await box.trigger('click')
    expect(isChecked(betaBox(w))).toBe(false)

    await setChecked(telemetryBox(w), true)
    expect(betaBox(w).attributes('aria-readonly')).toBe('false')
    expect(betaRow(w).attributes('title')).toBeUndefined()
  })

  it('persists both the telemetry and the beta choice at the same commit point', async () => {
    const w = await openWith({ telemetryEnabled: true })
    await setChecked(w.find('[data-testid="first-use-consent-tos"] [role="checkbox"]'), true)
    await w.find('[data-testid="first-use-pick-local"]').trigger('click')
    await setChecked(betaBox(w), false)
    await w.find('[data-testid="first-use-continue"]').trigger('click')
    await flushPromises()

    expect(window.api.setSetting).toHaveBeenCalledWith('telemetryEnabled', true)
    expect(window.api.setSetting).toHaveBeenCalledWith('betaFeaturesEnabled', false)
  })
})
