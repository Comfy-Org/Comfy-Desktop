// Start-screen tests for FirstUseTakeover. Heavy children are stubbed to focus on the start-step DOM.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn()
}))

vi.mock('../components/TakeoverHeader.vue', () => ({
  default: { template: '<div data-testid="stub-takeover-header"><slot /></div>' }
}))
vi.mock('../components/ModalShell.vue', () => ({
  default: { template: '<div data-testid="stub-modal-shell"><slot /></div>' }
}))
// Surfaces `selected` / `tabStop` as attributes so this file can assert
// which card the view designates as the radiogroup's tab stop. That the
// prop then produces `tabindex="0"` is ChoiceCard's own contract, covered
// in ChoiceCard.test.ts — asserted there against the real component
// rather than re-implemented in this stub.
vi.mock('../components/ChoiceCard.vue', () => ({
  default: {
    // Boolean-typed, not array-declared: a bare `selectable` attribute
    // arrives as `""` without a declared type, which is falsy and would
    // silently drop `role="radio"` off the stub.
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
    // `role="radio"` is reproduced because the view's arrow-key handler
    // delegates off it (`target.closest('[role="radio"]')`); without it the
    // keyboard tests would pass through a hole that doesn't exist in the
    // real component.
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

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false
})

/** `get-system-info` payload trimmed to the two fields this view reads.
 *  `gpu_tier` drives the Cloud recommendation, `gpu_label` the Express
 *  install hint. */
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
  // Telemetry assertions look for a single call by event name, so calls
  // must not leak in from the previous test.
  vi.mocked(emitTelemetryAction).mockClear()
  window.api = {
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(true),
    getLocale: vi.fn().mockResolvedValue('en'),
    // A capable GPU by default, so these baseline tests exercise the
    // fork-experiment default in isolation from the GPU-Aware Cloud Upsell
    // override (`hardwareRecommendsCloud`), which only fires on the
    // `sub_low` / `cpu_only` tiers. Tests for that feature set a poor tier
    // explicitly per-case.
    getSystemInfo: vi.fn().mockResolvedValue(systemInfo('high')),
    getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(true),
    setFirstUseMode: vi.fn(),
    closeHostWindow: vi.fn().mockResolvedValue(undefined),
    // Default to undefined so the existing tests exercise the control
    // branch (Local-default). Tests that need the treatment arm mutate
    // this per-case before mounting.
    telemetryGetExperimentFlag: vi.fn().mockResolvedValue(undefined),
    telemetryRecordExposure: vi.fn()
  } as unknown as typeof window.api
})

function mountTakeover() {
  return mount(FirstUseTakeover, {
    global: { plugins: [i18n] }
  })
}

describe('FirstUseTakeover start step', () => {
  it('Continue triggers a nudge shake on the ToS row when terms are not accepted', async () => {
    const wrapper = mountTakeover()
    const tosRow = wrapper.find('[data-testid="first-use-consent-tos"]')
    expect(tosRow.classes()).not.toContain('start-consent-row--nudge')

    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')
    expect(tosRow.classes()).toContain('start-consent-row--nudge')

    // No emit should fire — the click was blocked by the ToS gate.
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
    expect(tooltip?.getAttribute('data-text')).toBe('firstUse.whyTryCloud')
  })

  it('Express-install checkbox is visible on the default Local pick and hides only when Cloud is picked', async () => {
    const wrapper = mountTakeover()
    // Let the boot-time defaults settle so this test isolates the modifier
    // visibility transitions.
    await flushPromises()
    // The row stays mounted (reserved layout space, no jump on swap)
    // but is visually + a11y hidden whenever Cloud is the active pick.
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
    // Accept T&C (Continue is gated on it), pick Local, leave Express
    // at its default unchecked state, press Continue.
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    const emitted = wrapper.emitted('chain-local')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ express: false }])
  })

  it('emits `chain-local` with `express: true` when Express is explicitly ticked', async () => {
    const wrapper = mountTakeover()
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    await wrapper
      .find('[data-testid="first-use-express-install"] input[type="checkbox"]')
      .setValue(true)
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
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    // Express defaults to OFF; migrate is pre-ticked when legacy is
    // detected. The localBranch fork is only reachable when the user
    // explicitly opts out of migrate-existing too.
    await wrapper
      .find('[data-testid="first-use-migrate-existing"] input[type="checkbox"]')
      .setValue(false)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    // No chain-local fires — the user lands on the localBranch sub-step
    // to make the migrate-vs-fresh decision manually.
    expect(wrapper.emitted('chain-local')).toBeFalsy()
    expect(wrapper.find('[data-testid="first-use-local-migrate"]').exists()).toBe(true)
  })

  it('renders the "Migrate existing install" checkbox only when hasLegacyDesktop is true', async () => {
    const wrapper = mountTakeover()
    // Default open() has hasLegacyDesktop = false — the row is not in
    // the DOM at all (v-if), so no test-id should resolve. With no
    // legacy install detected, no migrate-related affordance is shown
    // anywhere on the start screen.
    expect(wrapper.find('[data-testid="first-use-migrate-existing"]').exists()).toBe(false)
    // After the host plumbs the detected legacy install in, the
    // checkbox mounts as a peer of Express. Visibility is then driven
    // by the Local pick via the hidden-class pattern.
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
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    // Migrate is pre-ticked on the legacy-desktop path; Express defaults
    // to OFF and must be ticked explicitly. The host uses the
    // `express: true` payload to skip the migrate confirm surface and
    // run preview + auto-pick + run straight through.
    await wrapper
      .find('[data-testid="first-use-express-install"] input[type="checkbox"]')
      .setValue(true)
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
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    // Untick Express but leave Migrate on: the user wants migration
    // but with the confirm surface (not the express-skip path).
    await wrapper
      .find('[data-testid="first-use-express-install"] input[type="checkbox"]')
      .setValue(false)
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
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-pick-local"]').trigger('click')
    // Untick migrate (returning user opts out, wants a clean Standalone)
    // and tick Express (now default-off, opt-in to the skip-Configure
    // path).
    await wrapper
      .find('[data-testid="first-use-migrate-existing"] input[type="checkbox"]')
      .setValue(false)
    await wrapper
      .find('[data-testid="first-use-express-install"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('chain-migrate')).toBeFalsy()
    const emitted = wrapper.emitted('chain-local')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ express: true }])
  })

  it('emits `complete-cloud` (not `chain-local`) when the user flips to Cloud and presses Continue', async () => {
    const wrapper = mountTakeover()
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    // Local is the default — flip to Cloud, then Continue.
    await wrapper.find('[data-testid="first-use-pick-cloud"]').trigger('click')
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    expect(wrapper.emitted('complete-cloud')).toBeTruthy()
    expect(wrapper.emitted('chain-local')).toBeFalsy()
  })

  it('Continue button switches to the loading copy + becomes disabled while Continue is in flight', async () => {
    const wrapper = mountTakeover()
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    const btn = wrapper.find('[data-testid="first-use-continue"]')
    expect(btn.text()).toBe('firstUse.startContinue')
    // Click — the express path's emit unmounts in real PanelApp, but in
    // the isolated test we stay mounted, so the busy copy persists.
    await btn.trigger('click')
    expect(btn.text()).toBe('firstUse.startContinueBusy')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('aria-busy')).toBe('true')
  })

  it('open() resets the Continue spinner so the cancel-and-return path lands on a fresh CTA', async () => {
    // Reproduces the start → uncheck express → Continue → cancel
    // mid-chain → open() again loop. `onContinue()` keeps the spinner
    // flag true past `routePostStart()` (the chain handlers normally
    // unmount), so on a cancel-and-return the host re-invokes open()
    // on the still-mounted instance with a stale `isContinuing=true`
    // — open() must reset it.
    const wrapper = mountTakeover()
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')
    // Sanity-check: the Continue button IS in the spinner state right
    // after click (the chain hasn't unmounted in the isolated test).
    const btnBusy = wrapper.find('[data-testid="first-use-continue"]')
    expect(btnBusy.text()).toBe('firstUse.startContinueBusy')
    expect(btnBusy.attributes('disabled')).toBeDefined()

    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()

    const btnFresh = wrapper.find('[data-testid="first-use-continue"]')
    expect(btnFresh.text()).toBe('firstUse.startContinue')
    expect(btnFresh.attributes('disabled')).toBeUndefined()
    expect(btnFresh.attributes('aria-busy')).toBe('false')
  })

  it('closing the terms modal clears termsDoc (modal unmounts)', async () => {
    const wrapper = mountTakeover()
    await wrapper.find('[data-testid="first-use-eula-link"]').trigger('click')
    const stub = wrapper.findComponent('[data-testid="stub-terms-modal"]')
    expect(stub.exists()).toBe(true)

    // The parent listens for the TermsModal's `close` emit and clears
    // termsDoc to null, which unmounts the v-if-gated modal.
    await stub.vm.$emit('close')
    expect(wrapper.find('[data-testid="stub-terms-modal"]').exists()).toBe(false)
  })

  it('Continue without touching the picker routes to chain-local (Local is the default)', async () => {
    const wrapper = mountTakeover()
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
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

    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    // Local is the resolved default → routed to chain-local without
    // touching the picker.
    expect(wrapper.emitted('chain-local')).toBeTruthy()
    expect(wrapper.emitted('complete-cloud')).toBeFalsy()
    // Exposure fires with source='fallback' because the flag returned
    // undefined (no cache, no recognised value).
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

    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')

    // Cloud is now the resolved default → Continue without touching
    // the picker routes to complete-cloud.
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

    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)

    // Continue stays disabled even with ToS accepted — the no-default
    // arm requires an explicit pick before commit.
    const btn = wrapper.find('[data-testid="first-use-continue"]')
    expect(btn.attributes('disabled')).toBeDefined()

    // Clicking it does nothing — no emit fires.
    await btn.trigger('click')
    expect(wrapper.emitted('chain-local')).toBeFalsy()
    expect(wrapper.emitted('complete-cloud')).toBeFalsy()

    // Pick Local → Continue activates.
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
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    await wrapper.find('[data-testid="first-use-continue"]').trigger('click')
    expect(wrapper.emitted('chain-local')).toBeTruthy()
    // 'control' is a string PostHog *might* return, so source is 'cache'
    // not 'fallback' even though the variant is the same as no-flag.
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

    // The migrate-existing checkbox renders → user with legacy install
    // landed on Local even though the cloud-default arm would have
    // flipped them to Cloud. Precedence holds.
    expect(wrapper.find('[data-testid="first-use-migrate-existing"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="first-use-express-install"]').classes()).not.toContain(
      'start-express--hidden'
    )
  })

  it('legacy-desktop precedence forces Local even when the no-default variant says pick-nothing', async () => {
    // Migration flow is the whole reason legacy users exist as a
    // cohort — we know they want their existing install brought over.
    // Pre-selecting nothing for them would force an extra click for
    // zero signal value, so the experiment is bypassed on this path.
    ;(window.api.telemetryGetExperimentFlag as ReturnType<typeof vi.fn>).mockResolvedValue('none')
    const wrapper = mountTakeover()
    await (
      wrapper.vm as unknown as { open: (opts: { hasLegacyDesktop: boolean }) => Promise<void> }
    ).open({ hasLegacyDesktop: true })
    await flushPromises()

    // Continue is immediately actionable — Local is pre-selected.
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
    const btn = wrapper.find('[data-testid="first-use-continue"]')
    expect(btn.attributes('disabled')).toBeUndefined()

    // Migrate-existing checkbox + Express checkbox both render —
    // confirms the Local card is the resolved pick (not null).
    expect(wrapper.find('[data-testid="first-use-migrate-existing"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="first-use-express-install"]').classes()).not.toContain(
      'start-express--hidden'
    )

    await btn.trigger('click')
    // Default opts: Migrate + Express both pre-ticked → chain-migrate.
    expect(wrapper.emitted('chain-migrate')).toBeTruthy()
  })
})

/**
 * GPU-Aware Cloud Upsell. The recommendation reads the shared `gpu_tier`
 * classifier (`deriveGpuTier`, via `get-system-info`) — the same signal
 * telemetry cohorts on — rather than re-deriving hardware capability here.
 */
describe('FirstUseTakeover GPU-aware Cloud recommendation', () => {
  const badge = (w: ReturnType<typeof mountTakeover>) =>
    w.find('[data-testid="first-use-cloud-reco"]')
  const pill = (w: ReturnType<typeof mountTakeover>) =>
    w.find('[data-testid="first-use-cloud-runs-pill"]')
  // The view's own `data-testid` wins over the stub's via attribute
  // fallthrough, so select on those rather than the stub's placeholder.
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

  // `sub_low` is the cohort the old `detectGPU()`-based stand-in missed
  // entirely: an Intel iGPU or a <6GB discrete card reports a GPU label,
  // so "no supported GPU detected" read it as capable hardware.
  it.each<GpuTier>(['cpu_only', 'sub_low'])('recommends Cloud on the %s tier', async (tier) => {
    expect(badge(await mountWithTier(tier)).exists()).toBe(true)
  })

  it('exposes the recommendation reason as the Cloud radio description', async () => {
    const wrapper = await mountWithTier('cpu_only', null)
    const cloudCard = wrapper.find('[data-testid="first-use-pick-cloud"]')
    const reasonId = cloudCard.attributes('aria-describedby')

    expect(reasonId).toBe('first-use-cloud-reco-reason')
    expect(wrapper.find(`#${reasonId}`).text()).toBe('firstUse.cloudRecommendedForHardwareTooltip')
  })

  it.each<GpuTier>(['high', 'mid', 'low', 'apple'])('leaves the %s tier alone', async (tier) => {
    const wrapper = await mountWithTier(tier)
    expect(badge(wrapper).exists()).toBe(false)
    // Local stays pre-selected — the control default is untouched.
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  it('fails closed when the system-info IPC rejects', async () => {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'))
    const wrapper = mountTakeover()
    await flushPromises()
    // Silence beats guessing: an unreachable classifier must not tell
    // someone with a 4090 that their hardware is inadequate.
    expect(badge(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
  })

  // `deriveGpuTier` reports `cpu_only` both for "no GPU" and for "discrete
  // GPU found, VRAM unreadable" — `si.graphics()` failing while `detectGPU()`
  // succeeds lands a 4090 in the second bucket. The tier alone can't tell
  // them apart, so the vendor + VRAM fields from the same payload have to.
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
    // And the no-preselect override stays off with it — an unverifiable
    // reading must not change the picker either.
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
    // Null VRAM is only disqualifying alongside a detected discrete vendor.
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('still recommends a discrete card whose VRAM really is small', async () => {
    ;(window.api.getSystemInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
      systemInfo('sub_low', 'NVIDIA', { gpu_vendor: 'nvidia', gpu_vram_gb: 4 })
    )
    const wrapper = mountTakeover()
    await flushPromises()
    // The guard is narrow: it suppresses unreadable VRAM, not low VRAM.
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('pre-selects neither card, gates Continue, and stays keyboard-reachable', async () => {
    const wrapper = await mountWithTier('cpu_only', null)
    for (const card of cards(wrapper)) expect(card.attributes('data-selected')).toBe('false')
    // Exactly one tab stop: without it the radiogroup is all
    // `tabindex="-1"` and, with Continue gated below, a keyboard-only user
    // has no way through at all.
    expect(cards(wrapper).filter((c) => c.attributes('data-tab-stop') === 'true')).toHaveLength(1)
    expect(wrapper.find('[data-testid="first-use-pick-cloud"]').attributes('data-tab-stop')).toBe(
      'true'
    )
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
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

    // Late classifier result must not yank the selection out from under a
    // user who already decided — Local IS the seeded default here, so
    // "still equals the default" can't distinguish this from untouched.
    resolveInfo(systemInfo('cpu_only', null))
    await flushPromises()
    expect(wrapper.find('[data-testid="first-use-pick-local"]').attributes('data-selected')).toBe(
      'true'
    )
    expect(badge(wrapper).exists()).toBe(true)
  })

  // The pill follows the free tier; the recommendation follows hardware.
  // Neither may drag the other down with it.
  it('hides the pill when free tier is off, leaving the recommendation alone', async () => {
    ;(window.api.getCloudFreeRunsEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const wrapper = await mountWithTier('cpu_only', null)
    expect(pill(wrapper).exists()).toBe(false)
    expect(badge(wrapper).exists()).toBe(true)
  })

  it('fails closed when the free-runs IPC rejects', async () => {
    ;(window.api.getCloudFreeRunsEnabled as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('nope')
    )
    // Never advertise an entitlement we couldn't confirm.
    expect(pill(await mountWithTier('cpu_only', null)).exists()).toBe(false)
  })

  it('reuses one system-info request across open() replays', async () => {
    const wrapper = await mountWithTier('cpu_only', null)
    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    // A full OS/CPU/GPU scan whose answer cannot change between a cancel
    // and a replay.
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
    await wrapper
      .find('[data-testid="first-use-consent-tos"] input[type="checkbox"]')
      .setValue(true)
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

  // `reco_shown` splits cloud-pick rate by whether the badge was seen —
  // without it there's no way to tell whether the badge does anything.
  it.each([
    ['cpu_only' as GpuTier, 'cloud' as const, true],
    ['high' as GpuTier, 'local' as const, false]
  ])('tags fork_chosen on %s with reco_shown=%s', async (tier, pick, shown) => {
    await commitWith(tier, pick)
    expect(forkChosenProps()).toMatchObject({ choice: pick, reco_shown: shown, gpu_tier: tier })
  })

  // The recommendation cohort had its assigned arm overridden to "nothing
  // selected", so it never experienced the arm; recording exposure would
  // bias the readout. `reco_shown` on the outcome events covers them.
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
