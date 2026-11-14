import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setChecked } from './testHelpers'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn()
}))

vi.mock('../components/ui/DesktopDialogSurface.vue', () => ({
  default: {
    props: ['ariaLabel'],
    template: '<div role="dialog" :aria-label="ariaLabel"><slot /></div>'
  }
}))
vi.mock('../components/TermsModal.vue', () => ({
  default: {
    props: ['doc'],
    template: '<div data-testid="stub-terms-modal" :data-doc="doc" />'
  }
}))

import FirstUseTakeover from './FirstUseTakeover.vue'
import { emitTelemetryAction } from '../lib/telemetry'
import type { SetupPlan } from '../lib/setupPlan'

const GB = 1024 ** 3

interface ApiOverrides {
  platform?: string
  free?: number
  locale?: string
  hardware?: { supported: boolean; error?: string; warning?: string }
  variant?: { value: string; label: string; size: number }
  releaseFails?: boolean
  settings?: Record<string, unknown>
}

function installApi(overrides: ApiOverrides = {}): void {
  const variant = overrides.variant ?? {
    value: 'mac-mps',
    label: 'Apple Silicon (MPS)',
    size: 1.2 * GB
  }
  window.api = {
    platform: overrides.platform ?? 'darwin',
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn(async (key: string) => overrides.settings?.[key]),
    getLocale: vi.fn().mockResolvedValue(overrides.locale ?? 'en'),
    validateHardware: vi.fn().mockResolvedValue(overrides.hardware ?? { supported: true }),
    getSystemInfo: vi.fn().mockResolvedValue({
      gpu_label: 'Apple M3 Max',
      gpu_model: 'Apple M3 Max',
      cpu_model: 'Apple M3 Max',
      total_memory_gb: 36,
      gpu_tier: 'high'
    }),
    getDefaultInstallDir: vi.fn().mockResolvedValue('/Users/ada/ComfyUI-Installs'),
    getDiskSpace: vi.fn().mockResolvedValue({ free: overrides.free ?? 412 * GB, total: 1000 * GB }),
    getSources: vi.fn().mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [
          { id: 'release', label: 'Release', type: 'select' },
          { id: 'comfyVersion', label: 'ComfyUI version', type: 'select' },
          { id: 'variant', label: 'Variant', type: 'select' },
          { id: 'bundledTemplate', label: 'Starter template', type: 'select' }
        ]
      }
    ]),
    getFieldOptions: vi.fn(async (_source: string, field: string) => {
      if (field === 'release') {
        if (overrides.releaseFails) throw new Error('offline')
        return [
          { value: 'stable', label: 'Stable', recommended: true, data: {} },
          { value: 'latest', label: 'Latest on GitHub', data: {} }
        ]
      }
      if (field === 'comfyVersion') {
        return [
          { value: 'v0.42.4', label: 'v0.42.4', recommended: true },
          { value: 'v0.42.3', label: 'v0.42.3' }
        ]
      }
      if (field === 'variant') {
        return [
          { value: 'mac-cpu', label: 'CPU', data: { variantId: 'mac-cpu', downloadFiles: [] } },
          {
            value: variant.value,
            label: variant.label,
            recommended: true,
            data: { variantId: variant.value, downloadFiles: [{ size: variant.size }] }
          }
        ]
      }
      return [
        { value: 'flux', label: 'Flux' },
        { value: 'none', label: 'None' }
      ]
    }),
    setFirstUseMode: vi.fn()
  } as unknown as typeof window.api
}

beforeEach(() => {
  vi.mocked(emitTelemetryAction).mockClear()
  installApi()
})

async function mountSetup(opts: { skipPick?: boolean; hasLegacyDesktop?: boolean } = {}) {
  const wrapper = mount(FirstUseTakeover)
  if (opts.skipPick || opts.hasLegacyDesktop) {
    await (wrapper.vm as unknown as { open: (o: typeof opts) => Promise<void> }).open(opts)
  }
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountSetup>>

const text = (w: Wrapper, id: string) => w.find(`[data-testid="${id}"]`).text()
const agree = (w: Wrapper) =>
  setChecked(w.find('[data-testid="setup-consent-tos"] [role="checkbox"]'), true)
const install = async (w: Wrapper) => {
  await w.find('[data-testid="setup-install"]').trigger('click')
  await flushPromises()
}

describe('Set up, the first screen', () => {
  it('shows what will be installed on this Mac before anything is chosen', async () => {
    const w = await mountSetup()

    expect(w.find('[role="dialog"]').attributes('aria-label')).toBe('Install ComfyUI on this Mac')
    expect(text(w, 'setup-lead')).toBe(
      'Checked for your Apple M3 Max. Change anything before you install.'
    )
    expect(text(w, 'setup-machine-name')).toBe('Apple M3 Max')
    expect(text(w, 'setup-machine')).toContain('36 GB memory')
    expect(text(w, 'setup-row-hardware')).toContain('Apple Silicon (MPS)')
    expect(text(w, 'setup-row-location')).toContain('~/ComfyUI-Installs/ComfyUI')
    expect(text(w, 'setup-row-location')).toContain('412 GB free · ~2.7 GB required')
    expect(text(w, 'setup-row-version')).toContain('ComfyUI v0.42.4 · Stable')
    expect(text(w, 'setup-row-version')).toContain('1.2 GB download')
  })

  it('names the computer the way the platform does', async () => {
    installApi({ platform: 'win32' })
    const pc = await mountSetup()
    expect(pc.find('[role="dialog"]').attributes('aria-label')).toBe('Install ComfyUI on this PC')

    installApi({ platform: 'linux' })
    const linux = await mountSetup()
    expect(linux.find('[role="dialog"]').attributes('aria-label')).toBe(
      'Install ComfyUI on this computer'
    )
  })

  it('says a CPU install has no GPU acceleration', async () => {
    installApi({ variant: { value: 'win-cpu', label: 'CPU', size: 0.9 * GB } })
    const w = await mountSetup()
    expect(text(w, 'setup-row-hardware')).toContain('CPU')
    expect(text(w, 'setup-row-hardware')).toContain('No GPU acceleration')
  })

  it('points at the terms instead of installing until they are agreed', async () => {
    const w = await mountSetup()
    await install(w)

    expect(w.emitted('install')).toBeUndefined()
    expect(text(w, 'setup-agree-hint')).toBe('Agree to install.')

    await agree(w)
    expect(w.find('[data-testid="setup-agree-hint"]').exists()).toBe(false)
  })

  it('installs the plan it showed, after saving the consent choices', async () => {
    const w = await mountSetup()
    await setChecked(w.find('[data-testid="setup-consent-beta"] [role="checkbox"]'), false)
    await agree(w)
    await install(w)

    expect(window.api.setSetting).toHaveBeenCalledWith('telemetryEnabled', true)
    expect(window.api.setSetting).toHaveBeenCalledWith('betaFeaturesEnabled', false)
    const [plan] = w.emitted('install')![0] as [SetupPlan]
    expect(plan.installRoot).toBe('/Users/ada/ComfyUI-Installs')
    expect(plan.selections.release?.value).toBe('stable')
    expect(plan.selections.comfyVersion?.value).toBe('v0.42.4')
    expect(plan.selections.variant?.value).toBe('mac-mps')
    expect(plan.selections.bundledTemplate?.value).toBe('none')
    expect(emitTelemetryAction).toHaveBeenCalledWith(
      'comfy.desktop.first_use.completed',
      expect.objectContaining({ exit_path: 'local-new' })
    )
  })

  it('opens every option with Change before the EULA is ticked, and says so', async () => {
    const w = await mountSetup()
    await w.find('[data-testid="setup-change"]').trigger('click')
    await flushPromises()

    expect(w.emitted('change')).toEqual([[{ consented: false }]])
    expect(w.find('[data-testid="setup-agree-hint"]').exists()).toBe(false)
  })

  it('tells New Build the EULA is already agreed when it was ticked first', async () => {
    const w = await mountSetup()
    await agree(w)
    await w.find('[data-testid="setup-change"]').trigger('click')
    await flushPromises()

    expect(w.emitted('change')).toEqual([[{ consented: true }]])
  })

  it('still needs the EULA to install, even after Change was usable', async () => {
    const w = await mountSetup()
    await install(w)

    expect(w.emitted('install')).toBeUndefined()
    expect(w.find('[data-testid="setup-agree-hint"]').exists()).toBe(true)
  })

  it('warns in the location row when the disk is too small', async () => {
    installApi({ free: 1.5 * GB })
    const w = await mountSetup()
    expect(text(w, 'setup-location-meta')).toBe('Only 1.5 GB free · ~2.7 GB required')
  })

  it('offers a retry and Change when the download server cannot be reached', async () => {
    installApi({ releaseFails: true })
    const w = await mountSetup()
    await agree(w)
    expect(text(w, 'setup-unavailable')).toContain("Couldn't reach the ComfyUI download server")

    await install(w)
    expect(w.emitted('install')).toBeUndefined()

    installApi()
    await w.find('[data-testid="setup-unavailable"] button').trigger('click')
    await flushPromises()
    await agree(w)
    await install(w)
    expect(w.emitted('install')).toHaveLength(1)
  })

  it('does not install on hardware ComfyUI cannot run on, and says why', async () => {
    const reason =
      'ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.'
    installApi({ hardware: { supported: false, error: reason } })
    const w = await mountSetup()
    await agree(w)
    await install(w)

    expect(w.emitted('install')).toBeUndefined()
    expect(text(w, 'setup-unsupported')).toBe(reason)
    await w.find('[data-testid="setup-change"]').trigger('click')
    await flushPromises()
    expect(w.emitted('change')).toHaveLength(1)
  })

  it('migrates a legacy ComfyUI Desktop by default, or installs fresh when unticked', async () => {
    const migrate = await mountSetup({ hasLegacyDesktop: true })
    await agree(migrate)
    expect(text(migrate, 'setup-install')).toBe('Migrate')
    await install(migrate)
    expect(migrate.emitted('chain-migrate')).toEqual([[{ express: false }]])
    expect(migrate.emitted('install')).toBeUndefined()

    const fresh = await mountSetup({ hasLegacyDesktop: true })
    await setChecked(fresh.find('[data-testid="setup-migrate-existing"] [role="checkbox"]'), false)
    await agree(fresh)
    await install(fresh)
    expect(fresh.emitted('install')).toHaveLength(1)
    expect(fresh.emitted('chain-migrate')).toBeUndefined()
  })

  it('lets someone who already has builds keep them instead of installing', async () => {
    const w = await mountSetup({ skipPick: true })
    await agree(w)
    await w.find('[data-testid="setup-skip"]').trigger('click')
    await flushPromises()
    expect(w.emitted('complete-skip')).toHaveLength(1)
    expect(w.emitted('install')).toBeUndefined()
  })

  it('asks about mirrors in China before installing', async () => {
    installApi({ locale: 'zh-CN' })
    const w = await mountSetup()
    await agree(w)
    await install(w)
    expect(w.emitted('install')).toBeUndefined()

    await w.find('[data-testid="setup-mirrors-accept"]').trigger('click')
    await flushPromises()
    expect(window.api.setSetting).toHaveBeenCalledWith('useChineseMirrors', true)
    expect(window.api.setSetting).toHaveBeenCalledWith('chineseMirrorsPrompted', true)
    expect(w.emitted('install')).toHaveLength(1)
  })

  it('opens the EULA, the Terms and the privacy policy from their links', async () => {
    const w = await mountSetup()
    for (const [link, doc] of [
      ['setup-eula-link', 'eula'],
      ['setup-tos-link', 'tos'],
      ['setup-telemetry-learn-more', 'privacy']
    ] as const) {
      await w.find(`[data-testid="${link}"]`).trigger('click')
      expect(w.find('[data-testid="stub-terms-modal"]').attributes('data-doc')).toBe(doc)
    }
    expect(
      w.find('[data-testid="setup-consent-tos"] [role="checkbox"]').attributes('aria-checked')
    ).toBe('false')
  })

  it('locks the title bar while the terms are unanswered and releases it when it closes', async () => {
    const w = await mountSetup()
    expect(window.api.setFirstUseMode).toHaveBeenLastCalledWith('consent-lockdown')
    w.unmount()
    expect(window.api.setFirstUseMode).toHaveBeenLastCalledWith('none')
  })
})

describe('Set up beta-features opt-in', () => {
  async function openWith(persisted: Record<string, unknown>): Promise<Wrapper> {
    installApi({ settings: persisted })
    return mountSetup()
  }

  const betaRow = (w: Wrapper) => w.find('[data-testid="setup-consent-beta"]')
  const betaBox = (w: Wrapper) => w.find('[data-testid="setup-consent-beta"] [role="checkbox"]')
  const telemetryBox = (w: Wrapper) =>
    w.find('[data-testid="setup-consent-telemetry"] [role="checkbox"]')
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
    await setChecked(telemetryBox(w), false)
    expect(isChecked(betaBox(w))).toBe(false)

    await setChecked(telemetryBox(w), true)
    expect(isChecked(betaBox(w))).toBe(false)
  })

  it('replays a persisted opt-out unchanged through a telemetry off/on cycle', async () => {
    const w = await openWith({ telemetryEnabled: true, betaFeaturesEnabled: false })
    expect(isChecked(betaBox(w))).toBe(false)
    await setChecked(telemetryBox(w), false)
    await setChecked(telemetryBox(w), true)
    expect(isChecked(betaBox(w))).toBe(false)
  })

  it('keeps a persisted opt-in when telemetry is off and saves it on install', async () => {
    const w = await openWith({ telemetryEnabled: false, betaFeaturesEnabled: true })
    expect(isChecked(betaBox(w))).toBe(true)

    await agree(w)
    await install(w)
    expect(window.api.setSetting).toHaveBeenCalledWith('telemetryEnabled', false)
    expect(window.api.setSetting).toHaveBeenCalledWith('betaFeaturesEnabled', true)
  })

  it('keeps the checkbox focusable and blocks activation without telemetry', async () => {
    const w = await openWith({ telemetryEnabled: false })
    const box = betaBox(w)
    const reasonId = box.attributes('aria-describedby')
    expect(box.attributes('disabled')).toBeUndefined()
    expect(box.attributes('aria-readonly')).toBe('true')
    expect(w.find(`#${reasonId}`).text()).toBe(
      'Beta features require confirming data sharing in Settings, even if telemetry is currently on.'
    )
    await box.trigger('click')
    expect(isChecked(betaBox(w))).toBe(false)

    await setChecked(telemetryBox(w), true)
    expect(betaBox(w).attributes('aria-readonly')).toBe('false')
    expect(betaRow(w).attributes('title')).toBeUndefined()
  })
})
