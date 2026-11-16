import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import InstallWizardModal from './InstallWizardModal.vue'
import BaseSelect from '../components/ui/BaseSelect.vue'
import SetupOptionCards from '../components/SetupOptionCards.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'
import { useModal } from '../composables/useModal'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import type { SavedSetup } from '../lib/setupPlan'

function mountModal(
  props: { hideBackToDashboard?: boolean } = {},
  options: { attachTo?: HTMLElement } = {}
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(InstallWizardModal, {
    props,
    ...options,
    global: {
      plugins: [pinia],
      stubs: {
        BrandTakeoverLayout: {
          template: '<div class="brand-takeover-stub"><slot /></div>'
        },
        DesktopDialogSurface: {
          template: '<div class="dialog-surface-stub"><slot /></div>'
        }
      }
    }
  })
}

function savedSetups(wrapper: ReturnType<typeof mountModal>): SavedSetup[] {
  return (wrapper.emitted('save-setup') ?? []).map(([saved]) => saved as SavedSetup)
}

async function showChangeSetup(wrapper: ReturnType<typeof mountModal>): Promise<void> {
  await wrapper.get('[data-testid="config-change-setup"]').trigger('click')
  await flushPromises()
}

const NEW_INSTALL = 'A new install'
const ALREADY_HAVE = 'ComfyUI I already have'

async function startFrom(wrapper: ReturnType<typeof mountModal>, label: string): Promise<void> {
  const option = wrapper
    .get('[data-testid="config-start-from"]')
    .findAll('button')
    .find((button) => button.text() === label)
  if (!option) throw new Error(`Start from has no option named ${label}`)
  await option.trigger('click')
  await flushPromises()
}

function chosenStartFrom(wrapper: ReturnType<typeof mountModal>): string | undefined {
  return wrapper
    .get('[data-testid="config-start-from"]')
    .findAll('button')
    .find((button) => button.attributes('data-state') === 'on')
    ?.text()
}

function existingComfyCards(wrapper: ReturnType<typeof mountModal>): string[] {
  return wrapper
    .get('[data-testid="existing-comfy-tabs"]')
    .findAll('.setup-option__label')
    .map((label) => label.text())
}

function startFromIsHeld(wrapper: ReturnType<typeof mountModal>): boolean {
  return wrapper
    .get('[data-testid="config-start-from"]')
    .findAll('button')
    .every((button) => button.attributes('disabled') !== undefined)
}

function mockSnapshotFile(): Record<string, ReturnType<typeof vi.fn>> {
  const api = window.api as unknown as Record<string, ReturnType<typeof vi.fn>>
  api.previewSnapshotFile = vi.fn().mockResolvedValue({
    ok: true,
    preview: {
      filePath: '/tmp/snap.json',
      installationName: 'Studio',
      snapshotCount: 1,
      snapshots: [],
      newestSnapshot: {
        comfyuiVersion: 'v0.4.2',
        pythonVersion: '3.12',
        createdAt: '2026-01-01T00:00:00Z',
        updateChannel: 'stable',
        comfyui: { variant: 'mps', releaseTag: '' },
        customNodes: [],
        pipPackages: {},
        pipPackageCount: 0
      }
    }
  })
  api.getFieldOptions = vi.fn(async (_source: string, fieldId: string) =>
    fieldId === 'release'
      ? [{ value: 'stable', label: 'Stable' }]
      : [{ value: 'mps', label: 'Apple Silicon (MPS)', data: { variantId: 'mps' } }]
  )
  return api
}

function mockPickedFolder(): Record<string, ReturnType<typeof vi.fn>> {
  const api = window.api as unknown as Record<string, ReturnType<typeof vi.fn>>
  api.probeInstallation = vi
    .fn()
    .mockResolvedValue([
      { sourceId: 'portable', sourceLabel: 'Portable', installPath: '/home/user/Picked' }
    ])
  api.trackInstallation = vi.fn().mockResolvedValue({ ok: true })
  return api
}

beforeEach(() => {
  useModal().dismiss()
  window.api = {
    openPath: vi.fn().mockResolvedValue(undefined),
    browseFolder: vi.fn().mockResolvedValue('/home/user/Picked'),
    detectGPU: vi.fn().mockResolvedValue(null),
    getDefaultInstallDir: vi.fn().mockResolvedValue('/home/user/ComfyUI'),
    getSources: vi.fn().mockResolvedValue([]),
    getFieldOptions: vi.fn().mockResolvedValue([]),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSetting: vi.fn().mockResolvedValue(false),
    onSettingsChanged: vi.fn(() => () => {}),
    getInstallationsSummary: vi.fn().mockResolvedValue({ localCount: 0 }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    getDiskSpace: vi.fn().mockResolvedValue(null),
    validateInstallPath: vi.fn().mockResolvedValue([]),
    buildInstallation: vi.fn().mockResolvedValue({ sourceId: 'standalone' }),
    addInstallation: vi.fn().mockResolvedValue({ ok: true }),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    installInstance: vi.fn().mockResolvedValue({ ok: true }),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {}),
      signIn: vi.fn(),
      signOut: vi.fn(),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      switchWorkspace: vi.fn(),
      listBuilds: vi.fn().mockResolvedValue([]),
      openBuildsPage: vi.fn().mockResolvedValue(undefined),
      installBuild: vi.fn()
    }
  } as unknown as typeof window.api
})

describe('InstallWizardModal heading', () => {
  it('opens Change from Set up as one sheet with the name, every option, and Save or Discard', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()

    expect(wrapper.get('.setup-modal-title').text()).toBe('Change setup')
    expect(wrapper.find('.config-name-card').exists()).toBe(false)
    const rows = wrapper
      .get('[data-testid="config-change-form"]')
      .findAll('.config-label')
      .map((label) => label.text())
    expect(rows).toEqual(['Get ComfyUI from', 'Name', 'Location', 'Hardware'])
    expect(wrapper.find('.config-name-row #inst-name-standalone').exists()).toBe(true)
    expect(wrapper.find('[data-testid="install-source-tabs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="config-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="config-change-setup"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="config-discard-changes"]').text()).toBe('Discard')
    expect(wrapper.get('[data-testid="config-save-changes"]').text()).toBe('Save changes')
    expect(wrapper.find('.config-continue').exists()).toBe(false)
    wrapper.unmount()
  })

  it('saves the picked setup back to Set up without asking for the EULA or installing', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        value: 'nvidia',
        label: 'NVIDIA',
        recommended: true,
        data: { variantId: 'win-nvidia', downloadFiles: [{ size: 1000 }] }
      },
      { value: 'cpu', label: 'CPU', data: { variantId: 'win-cpu', downloadFiles: [{ size: 400 }] } }
    ])
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, needsConsent: true, entrypoint: 'first_use' })
    await flushPromises()

    expect(wrapper.find('[data-testid="config-consent-tos"]').exists()).toBe(false)
    const cpu = wrapper.findAll('.setup-option').find((option) => option.text().includes('CPU'))
    if (!cpu) throw new Error('the CPU hardware card is missing')
    await cpu.trigger('click')
    await wrapper.get('#inst-name-standalone').setValue('Studio')
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()

    expect(window.api.addInstallation).not.toHaveBeenCalled()
    expect(window.api.installInstance).not.toHaveBeenCalled()
    expect(wrapper.emitted('show-progress')).toBeUndefined()
    const [saved] = savedSetups(wrapper)
    expect(saved?.plan).toMatchObject({
      sourceId: 'standalone',
      installRoot: '/home/user/ComfyUI',
      name: 'Studio',
      downloadBytes: 400,
      requiredBytes: 900,
      selections: { variant: expect.objectContaining({ value: 'cpu' }) }
    })
    expect(saved?.draft.instName).toBe('Studio')
    wrapper.unmount()
  })

  it('reopens Change on the setup saved before, ready to save again', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'nvidia', label: 'NVIDIA', recommended: true, data: { variantId: 'win-nvidia' } },
      { value: 'cpu', label: 'CPU', data: { variantId: 'win-cpu' } }
    ])
    const first = mountModal({ hideBackToDashboard: true })
    await first.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()
    await first
      .findAll('.setup-option')
      .find((option) => option.text().includes('CPU'))
      ?.trigger('click')
    await first.get('#inst-name-standalone').setValue('Studio')
    await first.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()
    const [saved] = savedSetups(first)
    first.unmount()
    if (!saved) throw new Error('Save changes emitted nothing')

    const again = mountModal({ hideBackToDashboard: true })
    await again.vm.open({ cameFromSetup: true, entrypoint: 'first_use', restore: saved.draft })
    await flushPromises()

    const checked = again
      .findAll('.setup-option')
      .filter((option) => option.attributes('aria-checked') === 'true')
      .map((option) => option.text())
    expect(checked.some((text) => text.includes('CPU'))).toBe(true)
    expect(checked.some((text) => text.includes('NVIDIA'))).toBe(false)
    expect((again.get('#inst-name-standalone').element as HTMLInputElement).value).toBe('Studio')
    await again.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()
    expect(savedSetups(again)[0]?.plan.selections.variant?.value).toBe('cpu')
    again.unmount()
  })

  it('keeps the saved choices when hardware picked after reopening Change is discarded', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'nvidia', label: 'NVIDIA', recommended: true, data: { variantId: 'win-nvidia' } },
      { value: 'cpu', label: 'CPU', data: { variantId: 'win-cpu' } }
    ])
    const pick = async (wrapper: ReturnType<typeof mountModal>, label: string) => {
      await wrapper
        .findAll('.setup-option')
        .find((option) => option.text().includes(label))
        ?.trigger('click')
      await flushPromises()
    }
    const checkedHardware = (wrapper: ReturnType<typeof mountModal>) =>
      wrapper
        .findAll('.setup-option')
        .filter((option) => option.attributes('aria-checked') === 'true')
        .map((option) => option.text())
        .filter((text) => text.includes('CPU') || text.includes('NVIDIA'))

    const first = mountModal({ hideBackToDashboard: true })
    await first.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()
    await pick(first, 'CPU')
    await first.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()
    const [saved] = savedSetups(first)
    first.unmount()
    if (!saved) throw new Error('Save changes emitted nothing')

    const edited = mountModal({ hideBackToDashboard: true })
    await edited.vm.open({ cameFromSetup: true, entrypoint: 'first_use', restore: saved.draft })
    await flushPromises()
    await pick(edited, 'NVIDIA')
    await edited.get('[data-testid="config-discard-changes"]').trigger('click')
    expect(edited.emitted('back-to-setup')).toEqual([[]])
    edited.unmount()

    const again = mountModal({ hideBackToDashboard: true })
    await again.vm.open({ cameFromSetup: true, entrypoint: 'first_use', restore: saved.draft })
    await flushPromises()
    expect(checkedHardware(again)).toEqual([expect.stringContaining('CPU')])
    again.unmount()
  })

  it('holds Discard and a second Save while Save is still checking the folder', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'cpu', label: 'CPU', recommended: true, data: { variantId: 'win-cpu' } }
    ])
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()
    let finishFolderCheck: (issues: string[]) => void = () => {}
    ;(window.api.validateInstallPath as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        finishFolderCheck = resolve
      })
    )

    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()
    expect(
      wrapper.get('[data-testid="config-discard-changes"]').attributes('disabled')
    ).toBeDefined()
    expect(wrapper.get('[data-testid="config-save-changes"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')

    finishFolderCheck([])
    await flushPromises()
    expect(wrapper.emitted('back-to-setup')).toBeUndefined()
    expect(savedSetups(wrapper)).toHaveLength(1)
    expect(window.api.validateInstallPath).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not ask for the EULA again when it was accepted on Set up', async () => {
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, needsConsent: false, entrypoint: 'first_use' })
    await flushPromises()

    expect(wrapper.find('[data-testid="config-consent-tos"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('returns to Set up as it was from Discard changes in the first-use Change sheet', async () => {
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()

    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')

    expect(wrapper.emitted('back-to-setup')).toEqual([[]])
    expect(wrapper.emitted('save-setup')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(window.api.addInstallation).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('uses the install-build title and local-install subtitle', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.get('.setup-modal-title').text()).toBe('New Build')
    expect(wrapper.find('[aria-label="New Build"]').exists()).toBe(true)
    expect(wrapper.get('.setup-modal-lead').text()).toBe('Setup a fresh ComfyUI install.')
    expect(wrapper.find('[data-testid="config-summary"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="config-change-form"]').exists()).toBe(false)
  })

  it('sums up the detected setup and opens every field from Change', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'mps', label: 'Apple Silicon (MPS)', description: '773 MB', recommended: true }
    ])
    ;(window.api.detectGPU as ReturnType<typeof vi.fn>).mockResolvedValue({
      label: 'Apple Silicon'
    })
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.get('[data-testid="detected-gpu-field"]').text()).toBe('Apple Silicon')
    expect(wrapper.get('.config-machine-kicker').text()).toBe('Detected')
    const rows = wrapper.findAll('.config-summary-row').map((row) => row.text())
    expect(wrapper.get('.config-name-card #inst-name-standalone').exists()).toBe(true)
    expect(rows[0]).toContain('Apple Silicon (MPS)')
    expect(rows[0]).toContain('773 MB')
    expect(rows[1]).toContain('/home/user/ComfyUI')
    expect(wrapper.find('#source-fields').exists()).toBe(false)
    expect(wrapper.get('.config-continue').text()).toBe('Install')

    await showChangeSetup(wrapper)

    expect(wrapper.get('.setup-modal-title').text()).toBe('Change setup')
    expect(wrapper.get('#source-fields').text()).toContain('Apple Silicon (MPS)')
    expect(wrapper.find('[data-testid="install-location-field"]').exists()).toBe(true)

    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    expect(wrapper.find('[data-testid="config-summary"]').exists()).toBe(true)
  })

  it('browses for a new location straight from the summary', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    await wrapper.get('.config-summary-location .config-path-browse').trigger('click')
    await flushPromises()

    expect(window.api.browseFolder).toHaveBeenCalledWith('/home/user/ComfyUI')
    expect(wrapper.get('.config-summary-location').text()).toContain('/home/user/Picked')
  })

  it('shows signed-out local fields directly like the Public workspace tab', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'comfyVersion', label: 'ComfyUI version', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'stable', label: 'Stable' }
    ])
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(wrapper.get('.config-advanced').classes()).toEqual(
      expect.arrayContaining(['config-advanced--direct', 'is-open'])
    )
    expect(wrapper.find('.config-advanced__summary').exists()).toBe(false)
    const fieldLabel = wrapper.get('#source-fields label')
    expect(fieldLabel.classes()).toContain('config-label')
    expect(fieldLabel.text()).toBe('ComfyUI version')
    expect(
      wrapper
        .get('[data-testid="install-source-tabs"]')
        .findAll('.setup-option__label')
        .map((label) => label.text())
    ).toEqual(['Official release', "Your team's builds"])
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-checked')
    ).toBe('false')
  })

  it('starts sign-in when a signed-out user selects Managed Builds', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    const status = {
      signedIn: true,
      workspaceId: 'personal-server-id',
      workspaceType: 'personal'
    }
    ;(window.api.comfybuilder.signIn as ReturnType<typeof vi.fn>).mockResolvedValue(status)
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ready', name: 'Ready Build', state: 'installable' }
    ])
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.signIn).toHaveBeenCalledOnce()
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-checked')
    ).toBe('true')
    expect(wrapper.get('[data-testid="workspace-build-field"]').text()).toContain('Ready Build')
  })

  it('reports a workspace load failure when Managed Builds cannot resolve Personal', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    ;(window.api.comfybuilder.signIn as ReturnType<typeof vi.fn>).mockResolvedValue({
      signedIn: true,
      workspaceId: 'team-workspace',
      workspaceType: 'team'
    })
    ;(window.api.comfybuilder.listWorkspaces as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('offline')
    )
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()

    const modal = useModal()
    expect(modal.state).toMatchObject({
      visible: true,
      type: 'alert',
      title: 'Error',
      message: "Couldn't load workspaces. Retry"
    })
    expect(window.api.comfybuilder.listBuilds).not.toHaveBeenCalled()
    modal.dismiss()
  })
})

describe('InstallWizardModal install-location field', () => {
  it('renders the default install location as a clickable path that opens the folder', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(wrapper.get('[data-testid="install-location-field"] .config-label').text()).toBe(
      'Location'
    )
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
    await showChangeSetup(wrapper)

    expect(wrapper.find('button.config-path-open').exists()).toBe(false)
    expect(window.api.openPath).not.toHaveBeenCalled()
  })

  describe('required space on the summary', () => {
    const hardwareSource = {
      id: 'standalone',
      label: 'Standalone',
      fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
    }

    async function openSummaryWithFreeSpace(free: number) {
      ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([hardwareSource])
      ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          value: 'mac-mps',
          label: 'Apple Silicon',
          recommended: true,
          data: { variantId: 'mac-mps', downloadFiles: [{ size: 8_000_000_000 }] }
        }
      ])
      ;(window.api.getDiskSpace as ReturnType<typeof vi.fn>).mockResolvedValue({
        free,
        total: 1_000_000_000_000
      })
      const wrapper = mountModal()
      ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
      await flushPromises()
      await vi.waitFor(() =>
        expect(wrapper.get('.config-summary-location').text()).toContain('free')
      )
      return wrapper
    }

    it('sits beside the free space when the build fits', async () => {
      const wrapper = await openSummaryWithFreeSpace(500_000_000_000)

      expect(wrapper.get('.config-summary-location').text()).toContain(
        '466 GB free · ~16.76 GB required'
      )
      expect(wrapper.find('.config-path-required').exists()).toBe(false)
    })

    it('is named once, as a warning, when the disk is short', async () => {
      const wrapper = await openSummaryWithFreeSpace(5_000_000_000)

      const location = wrapper.get('.config-summary-location').text()
      expect(wrapper.get('.config-path-required').text()).toBe('Needs about 16.76 GB')
      expect(location).toContain('5 GB free')
      expect(location.split('16.76 GB')).toHaveLength(2)
    })
  })
})

describe('InstallWizardModal workspace Builds', () => {
  function signInToWorkspace(builds: Array<Record<string, unknown>>): void {
    const status = {
      signedIn: true,
      workspaceId: 'w1',
      workspaceType: 'team'
    }
    ;(window.api.comfybuilder.getAuthStatus as ReturnType<typeof vi.fn>).mockResolvedValue(status)
    ;(window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue(status)
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue(builds)
  }

  async function openWorkspaceModal() {
    const wrapper = mountModal()
    await flushPromises()
    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w1' })
    await flushPromises()
    await showChangeSetup(wrapper)
    return wrapper
  }

  it('shows compatible Builds even when their releases are already installed', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] },
      { id: 'portable', label: 'Portable', fields: [] },
      { id: 'remote', label: 'Remote Connection', skipInstall: true, fields: [] }
    ])
    signInToWorkspace([
      { id: 'ready', name: 'Ready Build', state: 'installable' },
      { id: 'none', name: 'No Build Yet', state: 'no-build' },
      { id: 'linux', name: 'Linux Build', state: 'platform-mismatch' },
      { id: 'installed', name: 'Installed Build', state: 'installable', installedVersion: 2 },
      { id: 'linked', name: 'Linked Build', state: 'installable' },
      { id: 'update', name: 'Updated Build', state: 'update-available', installedVersion: 1 }
    ])
    const wrapper = mountModal()
    await flushPromises()
    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w1' })
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes()
    ).toMatchObject({ 'aria-checked': 'true' })
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('false')
    expect(
      wrapper
        .get('[data-testid="install-source-tabs"]')
        .findAll('.setup-option__label')
        .map((label) => label.text())
    ).toEqual(['Official release', "Your team's builds", 'Portable'])
    expect(chosenStartFrom(wrapper)).toBe(NEW_INSTALL)
    expect(wrapper.get('[data-testid="install-source-tabs"]').text()).not.toContain('RECOMMENDED')
    expect(wrapper.find('[data-testid="workspace-install-source-public"]').exists()).toBe(false)
    expect(wrapper.find('.config-advanced').exists()).toBe(false)
    expect(wrapper.get('[data-testid="workspace-build-field"] label').text()).toBe('Release')
    const buildSelect = wrapper.getComponent(BaseSelect)
    expect(buildSelect.props('options')).toEqual([
      { value: 'ready', label: 'Ready Build' },
      { value: 'installed', label: 'Installed Build' },
      { value: 'linked', label: 'Linked Build' },
      { value: 'update', label: 'Updated Build' }
    ])
    expect(buildSelect.props('modelValue')).toBe('ready')
  })

  it('goes from a team build to a server and back, then on to a peer source tab', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'version', label: 'Version', type: 'select' }]
      },
      {
        id: 'remote',
        label: 'Remote Connection',
        skipInstall: true,
        fields: [{ id: 'url', label: 'Server URL', type: 'text' }]
      }
    ])
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    const wrapper = await openWorkspaceModal()

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="install-source-remote"]').attributes('aria-checked')).toBe(
      'true'
    )
    expect(wrapper.find('[data-testid="install-source-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
    expect(wrapper.get('#source-fields').text()).toContain('Server URL')
    expect(window.api.getFieldOptions).not.toHaveBeenCalled()
    expect(window.api.validateHardware).not.toHaveBeenCalled()

    await startFrom(wrapper, NEW_INSTALL)

    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-checked')
    ).toBe('true')
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="existing-comfy-tabs"]').exists()).toBe(false)

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()

    expect(window.api.validateHardware).toHaveBeenCalledOnce()
    expect(window.api.getFieldOptions).toHaveBeenCalledOnce()
  })

  it('comes back from a server to the team build and the location that were picked', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] },
      {
        id: 'remote',
        label: 'Remote Connection',
        skipInstall: true,
        fields: [{ id: 'url', label: 'Server URL', type: 'text' }]
      }
    ])
    signInToWorkspace([
      { id: 'first', name: 'First', state: 'installable' },
      { id: 'second', name: 'Second', state: 'installable' }
    ])
    const wrapper = await openWorkspaceModal()
    wrapper.getComponent(BaseSelect).vm.$emit('update:modelValue', 'second')
    await wrapper.get('[data-testid="config-path-input"] .config-path-browse').trigger('click')
    await flushPromises()

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()
    await startFrom(wrapper, NEW_INSTALL)

    expect(wrapper.getComponent(BaseSelect).props('modelValue')).toBe('second')
    expect(wrapper.get('button.config-path-open').text()).toBe('/home/user/Picked')
  })

  it('holds Start from in first use while a workspace switch waits on authorization', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] },
      {
        id: 'remote',
        label: 'Remote Connection',
        skipInstall: true,
        fields: [{ id: 'url', label: 'Server URL', type: 'text' }]
      }
    ])
    signInToWorkspace([])
    let finishAuthorization!: (status: {
      signedIn: boolean
      workspaceId: string
      workspaceType: string
    }) => void
    ;(window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        finishAuthorization = resolve
      })
    )
    const wrapper = mountModal({ hideBackToDashboard: true })
    await flushPromises()

    const opening = wrapper.vm.open({ workspaceId: 'w2', cameFromSetup: true })
    await flushPromises()

    expect(wrapper.find('[data-testid="workspace-authorization-status"]').exists()).toBe(true)
    expect(startFromIsHeld(wrapper)).toBe(true)
    await startFrom(wrapper, ALREADY_HAVE)

    finishAuthorization({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
    await opening
    await flushPromises()

    expect(wrapper.find('[data-testid="workspace-authorization-status"]').exists()).toBe(false)
    expect(startFromIsHeld(wrapper)).toBe(false)
    expect(chosenStartFrom(wrapper)).toBe(NEW_INSTALL)
  })

  it('shows Build metadata in the dropdown without a separate details panel', async () => {
    signInToWorkspace([
      {
        id: 'ready',
        name: 'Production Build',
        description: 'Stable team environment',
        creatorName: 'Alice Builder',
        version: '3',
        state: 'installable'
      }
    ])
    const wrapper = await openWorkspaceModal()

    expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([
      {
        value: 'ready',
        label: 'Production Build',
        description: 'Stable team environment | Release v3 | By Alice Builder'
      }
    ])
    expect(wrapper.find('[data-testid="workspace-build-details"]').exists()).toBe(false)
  })

  it('refreshes the Build catalog every time the page opens', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', version: '2', state: 'installable' }])
    const wrapper = mountModal()
    await flushPromises()
    const open = (opts: { workspaceId: string }): Promise<void> =>
      (wrapper.vm as unknown as { open: (options: { workspaceId: string }) => Promise<void> }).open(
        opts
      )

    await open({ workspaceId: 'w1' })
    await flushPromises()
    await showChangeSetup(wrapper)
    expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([
      { value: 'ready', label: 'Ready Build', description: 'Release v2' }
    ])
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ready', name: 'Ready Build', version: '3', state: 'installable' }
    ])
    await open({ workspaceId: 'w1' })
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(window.api.comfybuilder.switchWorkspace).not.toHaveBeenCalled()
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledTimes(2)
    expect(wrapper.getComponent(BaseSelect).props('modelValue')).toBe('ready')
    expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([
      { value: 'ready', label: 'Ready Build', description: 'Release v3' }
    ])
  })

  it('installs Standalone directly with the recommended choice for each field', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Variant', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'cpu', label: 'CPU' },
      { value: 'nvidia', label: 'NVIDIA', recommended: true }
    ])
    const wrapper = await openWorkspaceModal()

    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"] .setup-option__label').text()
    ).toBe("Your team's builds")
    expect(wrapper.find('[data-testid="workspace-install-source-public"]').exists()).toBe(false)

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.setup-modal-lead').text()).toBe(
      'Everything here is already set to what fits this computer.'
    )
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
    expect(wrapper.get('.config-advanced').classes()).toContain('config-advanced--direct')
    expect(wrapper.get('.config-advanced').classes()).toContain('is-open')
    expect(wrapper.find('.config-advanced__summary').exists()).toBe(false)
    expect(wrapper.get('#source-fields').exists()).toBe(true)
    expect(wrapper.get('#source-fields label').classes()).toContain('config-label')
    expect(window.api.getFieldOptions).toHaveBeenCalledWith('standalone', 'variant', {}, undefined)

    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(window.api.buildInstallation).toHaveBeenCalledWith('standalone', {
      variant: expect.objectContaining({ value: 'nvidia' })
    })
    expect(window.api.comfybuilder.installBuild).not.toHaveBeenCalled()
  })

  it('assigns a Standalone install to the selected workspace', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'cpu', label: 'CPU' }
    ])
    ;(window.api.addInstallation as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: { id: 'public-1', name: 'ComfyUI' }
    })
    const wrapper = await openWorkspaceModal()

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(window.api.addInstallation).toHaveBeenCalledExactlyOnceWith({
      name: 'ComfyUI',
      installPath: '/home/user/ComfyUI',
      sourceId: 'standalone',
      status: 'installing',
      workspaceId: 'w1'
    })
  })

  it('uses the server Personal workspace for Builds but persists the stable local context', async () => {
    const status = {
      signedIn: true,
      workspaceId: 'server-personal-id',
      workspaceType: 'team',
      workspaceName: 'Personal workspace'
    }
    ;(window.api.comfybuilder.getAuthStatus as ReturnType<typeof vi.fn>).mockResolvedValue(status)
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ready', name: 'Personal Build', state: 'installable' }
    ])
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'cpu', label: 'CPU' }
    ])
    ;(window.api.addInstallation as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: { id: 'personal-public', name: 'ComfyUI' }
    })
    const wrapper = mountModal()
    await flushPromises()

    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'personal' })
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(window.api.comfybuilder.switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([
      { value: 'ready', label: 'Personal Build' }
    ])

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(window.api.addInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'personal' })
    )
  })

  it('switches back to cached Managed builds without another catalog request', async () => {
    signInToWorkspace([
      { id: 'ready', name: 'Ready Build', state: 'installable', sizeBytes: 2_000 }
    ])
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Variant', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        value: 'cuda',
        label: 'CUDA',
        data: { downloadFiles: [{ size: 1_000 }] }
      }
    ])
    const wrapper = await openWorkspaceModal()

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(PathDiskInfo).props('estimatedSize')).toBe(2_250)

    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.setup-modal-lead').text()).toBe(
      'Everything here is already set to what fits this computer.'
    )
    expect(wrapper.get('[data-testid="workspace-build-field"]').exists()).toBe(true)
    expect(wrapper.find('.config-advanced').exists()).toBe(false)
    expect(wrapper.getComponent(PathDiskInfo).props('estimatedSize')).toBe(4_500)
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
  })

  it('installs the team build after a visit to the Standalone tab', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Variant', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'nvidia', label: 'NVIDIA', recommended: true }
    ])
    ;(window.api.comfybuilder.installBuild as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: { id: 'managed-1', name: 'Ready Build' }
    })
    const wrapper = await openWorkspaceModal()

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.installBuild).toHaveBeenCalledOnce()
    expect(window.api.buildInstallation).not.toHaveBeenCalled()
  })

  it('saves a team build picked in first-use Change back to Set up without installing it', async () => {
    signInToWorkspace([
      {
        id: 'ready',
        name: 'Ready Build',
        state: 'installable',
        sizeBytes: 2_000,
        releaseTargets: [
          {
            artifactId: 'cuda',
            releaseVersion: 3,
            os: 'windows',
            gpu: 'nvidia',
            accelVariant: 'cu128',
            recommended: true
          }
        ]
      }
    ])
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    const wrapper = mountModal({ hideBackToDashboard: true })
    await flushPromises()
    await wrapper.vm.open({ cameFromSetup: true, entrypoint: 'first_use', workspaceId: 'w1' })
    await flushPromises()

    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.installBuild).not.toHaveBeenCalled()
    expect(savedSetups(wrapper)[0]?.plan).toMatchObject({
      installRoot: '/home/user/ComfyUI',
      requiredBytes: 4_500,
      workspaceBuild: {
        buildId: 'ready',
        buildName: 'Ready Build',
        artifactId: 'cuda',
        releaseVersion: 3,
        targetLabel: 'Windows - NVIDIA (CUDA 12.8)'
      }
    })
  })

  it('opens the selected workspace Builds page online', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    const wrapper = await openWorkspaceModal()

    await wrapper.get('.workspace-build-online').trigger('click')

    expect(window.api.comfybuilder.openBuildsPage).toHaveBeenCalledExactlyOnceWith('w1')
    expect(wrapper.get('.workspace-build-online').text()).toBe('View builds online')
  })

  it('defaults to Public Builds when no managed Build is compatible with this machine', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    signInToWorkspace([{ id: 'linux', name: 'Linux Build', state: 'platform-mismatch' }])
    const wrapper = await openWorkspaceModal()

    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-checked')
    ).toBe('false')
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
  })

  it('defaults to Public Builds when the workspace has no managed Builds', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    signInToWorkspace([])
    const wrapper = await openWorkspaceModal()

    expect(wrapper.get('.setup-modal-lead').text()).toBe(
      'Everything here is already set to what fits this computer.'
    )
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-checked')
    ).toBe('false')
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
  })

  it('uses a prefetched empty managed catalog without loading it again', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    signInToWorkspace([])
    const wrapper = mountModal()
    await flushPromises()
    const authStore = useAuthStore()
    authStore.builds = []
    authStore.buildsLoaded = true

    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w1' })
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(window.api.comfybuilder.listBuilds).not.toHaveBeenCalled()
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('true')
  })

  it('retires a pending workspace pick once it attempts the switch itself', async () => {
    signInToWorkspace([])
    ;(window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue({
      signedIn: true,
      workspaceId: 'w1',
      workspaceType: 'team',
      workspaceSwitchFailure: 'retryable'
    })
    const wrapper = mountModal()
    await flushPromises()
    const scope = useDashboardScopeStore()
    scope.selectWorkspace('w2')

    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w2' })
    await flushPromises()

    expect(window.api.comfybuilder.switchWorkspace).toHaveBeenCalledWith('w2', 'chosen')
    expect(scope.takeChosenSelection()).toBe(false)
  })

  it('activates the selected workspace before loading its Builds', async () => {
    signInToWorkspace([])
    ;(window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue({
      signedIn: true,
      workspaceId: 'w2',
      workspaceType: 'team'
    })
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ready', name: 'Workspace Two Build', state: 'installable' }
    ])
    const wrapper = mountModal()
    await flushPromises()

    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w2' })
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(window.api.comfybuilder.switchWorkspace).toHaveBeenCalledExactlyOnceWith('w2', 'chosen')
    expect(
      (window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      (window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!
    )
    expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([
      { value: 'ready', label: 'Workspace Two Build' }
    ])
  })

  describe('after Desktop returned to the anchor workspace', () => {
    const readyBuild = { id: 'ready', name: 'Workspace Two Build', state: 'installable' }

    async function openOnW2ThenReturnToAnchor() {
      signInToWorkspace([])
      let authChanged: (status: unknown) => void = () => {}
      ;(window.api.comfybuilder.onAuthChanged as ReturnType<typeof vi.fn>).mockImplementation(
        (callback: (status: unknown) => void) => {
          authChanged = callback
          return () => {}
        }
      )
      const switchWorkspace = window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>
      const listBuilds = window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>
      switchWorkspace.mockResolvedValue({
        signedIn: true,
        workspaceId: 'w2',
        workspaceType: 'team'
      })
      listBuilds.mockResolvedValue([readyBuild])
      const wrapper = mountModal()
      await flushPromises()
      await (
        wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
      ).open({ workspaceId: 'w2' })
      await flushPromises()
      await showChangeSetup(wrapper)
      expect(wrapper.getComponent(BaseSelect).props('options')).toHaveLength(1)
      authChanged({ signedIn: true, workspaceId: 'w1', workspaceType: 'team' })
      await flushPromises()
      expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([])
      switchWorkspace.mockClear()
      listBuilds.mockClear()
      return { wrapper, switchWorkspace, listBuilds }
    }

    it('Refresh re-establishes the target workspace before fetching its Builds', async () => {
      const { wrapper, switchWorkspace, listBuilds } = await openOnW2ThenReturnToAnchor()

      await wrapper.get('.workspace-build-refresh').trigger('click')
      await flushPromises()

      expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('w2', 'chosen')
      expect(listBuilds).toHaveBeenCalledOnce()
      expect(switchWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
        listBuilds.mock.invocationCallOrder[0]!
      )
      expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([
        { value: 'ready', label: 'Workspace Two Build' }
      ])
    })

    it.each(['.workspace-build-refresh', '.wizard-build-retry'])(
      '%s is disabled while the target workspace is being re-established',
      async (button) => {
        const { wrapper, switchWorkspace } = await openOnW2ThenReturnToAnchor()
        useAuthStore().buildsError = true
        await flushPromises()
        let finish: (status: unknown) => void = () => {}
        switchWorkspace.mockReturnValue(new Promise((resolve) => (finish = resolve)))

        await wrapper.get(button).trigger('click')
        await flushPromises()
        expect(wrapper.get(button).attributes('disabled')).toBeDefined()
        await wrapper.get(button).trigger('click')

        finish({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
        await flushPromises()
        expect(switchWorkspace).toHaveBeenCalledOnce()
      }
    )

    it('Refresh fetches nothing for the anchor when the target cannot be re-established', async () => {
      const { wrapper, switchWorkspace, listBuilds } = await openOnW2ThenReturnToAnchor()
      switchWorkspace.mockResolvedValue({
        signedIn: true,
        workspaceId: 'w1',
        workspaceType: 'team',
        workspaceSwitchFailure: 'retryable'
      })

      await wrapper.get('.workspace-build-refresh').trigger('click')
      await flushPromises()

      expect(listBuilds).not.toHaveBeenCalled()
      expect(wrapper.emitted('close')).toHaveLength(1)
    })
  })

  it('Refresh on the target workspace only fetches and keeps the selected Build', async () => {
    signInToWorkspace([])
    const switchWorkspace = window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>
    switchWorkspace.mockResolvedValue({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
    const listBuilds = window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>
    listBuilds.mockResolvedValue([
      { id: 'first', name: 'First', state: 'installable' },
      { id: 'second', name: 'Second', state: 'installable' }
    ])
    const wrapper = mountModal()
    await flushPromises()
    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w2' })
    await flushPromises()
    await showChangeSetup(wrapper)
    wrapper.getComponent(BaseSelect).vm.$emit('update:modelValue', 'second')
    await flushPromises()
    switchWorkspace.mockClear()

    await wrapper.get('.workspace-build-refresh').trigger('click')
    await flushPromises()

    expect(switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.getComponent(BaseSelect).props('modelValue')).toBe('second')
  })

  it('explains that a workspace switch may be waiting on browser authorization', async () => {
    signInToWorkspace([])
    let finishAuthorization!: (status: {
      signedIn: boolean
      workspaceId: string
      workspaceType: string
    }) => void
    ;(window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        finishAuthorization = resolve
      })
    )
    const wrapper = mountModal()
    await flushPromises()

    const opening = (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w2' })
    await flushPromises()

    expect(wrapper.get('[data-testid="workspace-authorization-status"]').text()).toBe(
      'Waiting for workspace authorization... Complete authorization in your browser if prompted.'
    )

    finishAuthorization({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
    await opening
    await flushPromises()
    expect(wrapper.find('[data-testid="workspace-authorization-status"]').exists()).toBe(false)
  })

  it('closes without loading Builds when workspace authorization is cancelled', async () => {
    signInToWorkspace([])
    ;(window.api.comfybuilder.switchWorkspace as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cancelled')
    )
    const wrapper = mountModal()
    await flushPromises()

    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w2' })
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(window.api.comfybuilder.listBuilds).not.toHaveBeenCalled()
  })

  it('retries a failed Build catalog request from the wizard', async () => {
    signInToWorkspace([])
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    const wrapper = await openWorkspaceModal()

    await wrapper.get('.wizard-build-retry').trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledTimes(2)
    expect(wrapper.getComponent(BaseSelect).props('options')).toEqual([
      { value: 'ready', label: 'Ready Build' }
    ])
  })

  it('shows a failed Build catalog on the summary and retries it from there', async () => {
    signInToWorkspace([])
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    const wrapper = mountModal()
    await flushPromises()
    await (
      wrapper.vm as unknown as { open: (opts: { workspaceId: string }) => Promise<void> }
    ).open({ workspaceId: 'w1' })
    await flushPromises()

    const retry = wrapper.get('[data-testid="config-summary-build-retry"]')
    expect(retry.text()).toBe("Couldn't load builds. Retry")
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeDefined()

    await retry.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="config-summary-build-retry"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="config-summary"]').text()).toContain('Ready Build')
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeUndefined()
  })

  it('keeps the Build Desktop picked when Discard follows a refresh that dropped the old one', async () => {
    signInToWorkspace([{ id: 'alpha', name: 'Alpha Build', state: 'installable' }])
    const wrapper = await openWorkspaceModal()
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'beta', name: 'Beta Build', state: 'installable' }
    ])

    await wrapper.get('.workspace-build-refresh').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="config-summary"]').text()).toContain('Beta Build')
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeUndefined()
  })

  it('installs the selected Build with the requested name and install root', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    ;(window.api.comfybuilder.installBuild as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: { id: 'managed-1', name: 'My Managed Instance' }
    })
    const wrapper = await openWorkspaceModal()
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await wrapper.get('#inst-name-standalone').setValue('My Managed Instance')
    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.installBuild).toHaveBeenCalledExactlyOnceWith({
      buildId: 'ready',
      name: 'My Managed Instance',
      installRoot: '/home/user/ComfyUI'
    })
    expect(wrapper.emitted('show-progress')?.[0]?.[0]).toMatchObject({
      installationId: 'managed-1',
      autoLaunchOnFinish: true,
      opKind: 'install'
    })
  })

  it('lets users choose among compatible managed Build release targets', async () => {
    signInToWorkspace([
      {
        id: 'ready',
        name: 'Ready Build',
        version: '3',
        state: 'installable',
        releaseTargets: [
          {
            artifactId: 'cuda',
            releaseVersion: 3,
            os: 'windows',
            gpu: 'nvidia',
            accelVariant: 'cu128',
            recommended: true
          },
          {
            artifactId: 'cpu',
            releaseVersion: 3,
            os: 'windows',
            gpu: 'cpu',
            accelVariant: 'cpu',
            recommended: false
          }
        ]
      }
    ])
    ;(window.api.comfybuilder.installBuild as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: { id: 'managed-1', name: 'Ready Build' }
    })
    const wrapper = await openWorkspaceModal()

    expect(wrapper.find('.config-advanced').exists()).toBe(false)
    const targetSection = wrapper.get('[data-testid="workspace-build-targets"]')
    expect(targetSection.isVisible()).toBe(true)
    expect(targetSection.get('label').text()).toBe('Hardware')
    const targetPicker = targetSection.getComponent(SetupOptionCards)
    expect(targetPicker.props('options')).toEqual([
      expect.objectContaining({
        value: 'cuda',
        label: 'Windows - NVIDIA (CUDA 12.8)',
        description: 'Release v3',
        recommended: true
      }),
      expect.objectContaining({
        value: 'cpu',
        label: 'Windows - CPU',
        description: 'Release v3',
        recommended: false
      })
    ])
    expect(targetPicker.props('selectedValue')).toBe('cuda')

    await targetPicker.findAll('button')[1]!.trigger('click')
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.installBuild).toHaveBeenCalledExactlyOnceWith({
      buildId: 'ready',
      artifactId: 'cpu',
      releaseVersion: 3,
      installRoot: '/home/user/ComfyUI'
    })
  })
})

describe('InstallWizardModal onboarding->install handoff telemetry (#1224)', () => {
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

  it('adds a folder picked in Change setup under the name typed on New Build, without reporting a cancelled wizard', async () => {
    const api = mockPickedFolder()
    const { events, stop } = captureTelemetry()
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await wrapper.get('#inst-name-standalone').setValue('Studio')
    await showChangeSetup(wrapper)

    await startFrom(wrapper, ALREADY_HAVE)
    const addBuild = wrapper.get('[data-testid="config-use-existing"]')
    expect(addBuild.text()).toBe('Add build')
    expect(addBuild.attributes('disabled')).toBeDefined()

    await wrapper.get('.track-location .config-path-browse').trigger('click')
    await flushPromises()
    expect(addBuild.attributes('disabled')).toBeUndefined()
    await addBuild.trigger('click')
    await flushPromises()

    expect(api.trackInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Studio', installPath: '/home/user/Picked' })
    )
    expect(wrapper.emitted('navigate-list')).toHaveLength(1)

    wrapper.unmount()
    stop()

    expect(events.map((e) => e.actionName)).toContain('comfy.desktop.track_existing.saved')
    expect(events.map((e) => e.actionName)).not.toContain('comfy.desktop.install.not_started')
  })

  it('starts the install of a snapshot loaded in Change setup, without reporting a cancelled wizard', async () => {
    const api = mockSnapshotFile()
    api.createFromSnapshot = vi
      .fn()
      .mockResolvedValue({ ok: true, entry: { id: 'inst-1', name: 'Studio' } })
    const { events, stop } = captureTelemetry()
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="existing-comfy-snapshot"]').trigger('click')
    await flushPromises()
    const createBuild = wrapper.get('[data-testid="config-use-existing"]')
    expect(createBuild.text()).toBe('Create build')
    expect(createBuild.attributes('disabled')).toBeDefined()

    await wrapper.get('.load-snapshot-tertiary').trigger('click')
    await flushPromises()
    await createBuild.trigger('click')
    await flushPromises()

    expect(api.createFromSnapshot).toHaveBeenCalledWith('/tmp/snap.json', 'Studio', 'stable', 'mps')
    expect(wrapper.emitted('show-progress')).toEqual([
      [expect.objectContaining({ installationId: 'inst-1', opKind: 'install' })]
    ])

    wrapper.unmount()
    stop()

    expect(events.map((e) => e.actionName)).not.toContain('comfy.desktop.install.not_started')
  })
})

describe('InstallWizardModal hardware warning', () => {
  const KFD_WARNING =
    'Your user cannot access the AMD GPU compute interface (/dev/kfd), so ComfyUI will not be able to use the GPU.'
  const standaloneSource = { id: 'standalone', label: 'Standalone', fields: [] }
  const remoteSource = { id: 'remote', label: 'Remote Connection', skipInstall: true, fields: [] }

  it('renders the validateHardware warning under the detected GPU field', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([standaloneSource])
    ;(window.api.detectGPU as ReturnType<typeof vi.fn>).mockResolvedValue({
      label: 'Radeon RX 7900'
    })
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: true,
      warning: KFD_WARNING
    })
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    const warning = wrapper.find('[data-testid="wizard-hardware-warning"]')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toBe(KFD_WARNING)
    const machine = wrapper.get('.config-machine').element
    expect(
      machine.compareDocumentPosition(warning.element) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
    expect(wrapper.get('[data-testid="detected-gpu-field"]').text()).toBe('Radeon RX 7900')
  })

  it('renders no warning element when validateHardware reports none', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([standaloneSource])
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(false)
  })

  it('drops the warning once the build is a ComfyUI the person already has', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      standaloneSource,
      remoteSource
    ])
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: true,
      warning: KFD_WARNING
    })
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(true)

    await showChangeSetup(wrapper)
    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(true)

    await startFrom(wrapper, ALREADY_HAVE)
    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(false)

    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(false)
  })

  it('keeps the hardware warning visible in Change setup', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([standaloneSource])
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: true,
      warning: KFD_WARNING
    })
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    expect(wrapper.get('[data-testid="wizard-hardware-warning"]').text()).toBe(KFD_WARNING)
  })

  it('connects a machine that cannot run ComfyUI to a server', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      standaloneSource,
      remoteSource
    ])
    ;(window.api.detectGPU as ReturnType<typeof vi.fn>).mockResolvedValue({ label: 'Old GPU' })
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: false,
      error: 'This CPU is missing AVX support.'
    })
    ;(window.api.buildInstallation as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceId: 'remote'
    })
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.find('.config-machine--unsupported').exists()).toBe(true)
    expect(wrapper.get('[data-testid="detected-gpu-field"]').text()).toBe(
      'This CPU is missing AVX support.'
    )

    await showChangeSetup(wrapper)
    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()
    const connect = wrapper.get('[data-testid="config-use-existing"]')
    expect(connect.text()).toBe('Connect')
    await connect.trigger('click')
    await flushPromises()

    expect(window.api.addInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'remote', status: 'installed', installPath: '' })
    )
    expect(wrapper.emitted('navigate-list')).toHaveLength(1)
  })

  it('goes back to the unsupported machine when a server is given up for a new install', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      standaloneSource,
      remoteSource
    ])
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: false,
      error: 'This CPU is missing AVX support.'
    })
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()
    await startFrom(wrapper, NEW_INSTALL)

    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('false')
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    expect(wrapper.find('.config-machine--unsupported').exists()).toBe(true)
  })
})

describe('InstallWizardModal Change setup', () => {
  const releaseSource = {
    id: 'standalone',
    label: 'Standalone',
    fields: [
      { id: 'release', label: 'Release', type: 'select' },
      { id: 'comfyVersion', label: 'ComfyUI version', type: 'select' }
    ]
  }
  const remoteSource = { id: 'remote', label: 'Remote Connection', skipInstall: true, fields: [] }

  function mockReleaseOptions(): void {
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockImplementation(
      async (_source: string, fieldId: string, selections: Record<string, { value: string }>) => {
        if (fieldId === 'release') {
          return [
            { value: 'stable', label: 'Stable', recommended: true },
            { value: 'latest', label: 'Latest on GitHub' }
          ]
        }
        if (selections.release?.value !== 'stable') return []
        return [
          { value: 'v0.4.2', label: 'v0.4.2', recommended: true },
          { value: 'v0.4.1', label: 'v0.4.1' }
        ]
      }
    )
  }

  async function openChangeSetup(props: { hideBackToDashboard?: boolean } = {}) {
    const wrapper = mountModal(props)
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)
    return wrapper
  }

  async function pickRelease(wrapper: ReturnType<typeof mountModal>, label: string): Promise<void> {
    const choice = wrapper
      .get('[data-testid="config-release"]')
      .findAll('button')
      .find((button) => button.text() === label)
    if (!choice) throw new Error(`Release has no choice named ${label}`)
    await choice.trigger('click')
    await flushPromises()
  }

  function pickedRelease(wrapper: ReturnType<typeof mountModal>): string | undefined {
    return wrapper
      .get('[data-testid="config-release"]')
      .findAll('button')
      .find((button) => button.attributes('data-state') === 'on')
      ?.text()
  }

  it('picks the release with a segmented control and shows the version only for Stable', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    mockReleaseOptions()
    const wrapper = await openChangeSetup()

    const release = wrapper.get('[data-testid="config-release"] [role="group"]')
    expect(release.findAll('button').map((button) => button.text())).toEqual([
      'Stable',
      'Latest on GitHub'
    ])
    const version = wrapper.get('.config-release-version')
    expect(version.get('.ui-select-leading').text()).toBe('ComfyUI')
    expect(version.get('.ui-select-label').text()).toBe('v0.4.2')
    expect(
      wrapper
        .findAll('.config-source-field')
        .map((row) => (row.element as HTMLElement).style.display)
    ).toEqual(['', 'none'])

    await release.findAll('button')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.config-release-version').exists()).toBe(false)
  })

  it('puts the free space and Browse inside the location field', async () => {
    ;(window.api.getDiskSpace as ReturnType<typeof vi.fn>).mockResolvedValue({
      free: 50_000_000_000,
      total: 1_000_000_000_000
    })
    const wrapper = await openChangeSetup()
    await vi.waitFor(() => expect(wrapper.find('.config-path-free').exists()).toBe(true))

    const input = wrapper.get('[data-testid="config-path-input"]')
    expect(input.find('.config-path-free').text()).toContain('free')
    expect(input.find('.config-path-browse').text()).toBe('Browse')
    expect(wrapper.find('.config-path-required').exists()).toBe(false)

    await input.get('.config-path-browse').trigger('click')
    await flushPromises()
    expect(wrapper.get('button.config-path-open').text()).toBe('/home/user/Picked')
  })

  it('keeps the setup as it was when Discard is pressed', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    const wrapper = await openChangeSetup()

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.config-continue').text()).toBe('Install')
    await showChangeSetup(wrapper)
    expect(chosenStartFrom(wrapper)).toBe(NEW_INSTALL)
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('true')
    expect(wrapper.get('.config-release-version').exists()).toBe(true)
  })

  it('keeps the release and version picked for a new install while the folder form is looked at', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    const wrapper = await openChangeSetup()
    wrapper
      .findAllComponents(BaseSelect)
      .find((select) => select.props('leading') === 'ComfyUI')!
      .vm.$emit('update:modelValue', 'v0.4.1')
    await flushPromises()
    const loadsBefore = (window.api.getFieldOptions as ReturnType<typeof vi.fn>).mock.calls.length

    await startFrom(wrapper, ALREADY_HAVE)
    expect(wrapper.find('[data-testid="install-source-tabs"]').exists()).toBe(false)
    expect(wrapper.find('.config-release-version').exists()).toBe(false)
    await startFrom(wrapper, NEW_INSTALL)

    expect(pickedRelease(wrapper)).toBe('Stable')
    expect(wrapper.get('.config-release-version .ui-select-label').text()).toBe('v0.4.1')
    expect((window.api.getFieldOptions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      loadsBefore
    )
  })

  it('keeps the release picked for a new install after a server was looked at, without loading it again', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    const wrapper = await openChangeSetup()
    await pickRelease(wrapper, 'Latest on GitHub')
    const loadsBefore = (window.api.getFieldOptions as ReturnType<typeof vi.fn>).mock.calls.length

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()
    await startFrom(wrapper, NEW_INSTALL)

    expect(pickedRelease(wrapper)).toBe('Latest on GitHub')
    expect((window.api.getFieldOptions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      loadsBefore
    )
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    expect(wrapper.get('[data-testid="config-summary"]').text()).toContain('Latest on GitHub')
  })

  it('saves what was picked in first use after ComfyUI I already have was only looked at', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()
    await pickRelease(wrapper, 'Latest on GitHub')

    await startFrom(wrapper, ALREADY_HAVE)
    expect(wrapper.get('[data-testid="install-source-remote"]').attributes('aria-checked')).toBe(
      'true'
    )
    await startFrom(wrapper, NEW_INSTALL)

    expect(pickedRelease(wrapper)).toBe('Latest on GitHub')
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()
    expect(savedSetups(wrapper)[0]?.plan).toMatchObject({
      sourceId: 'standalone',
      selections: { release: expect.objectContaining({ value: 'latest' }) }
    })
  })

  it('drops a first-use Save when the release changes while the folder is being checked', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    mockReleaseOptions()
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()
    let finishFolderCheck: (issues: string[]) => void = () => {}
    ;(window.api.validateInstallPath as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        finishFolderCheck = resolve
      })
    )

    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()
    await pickRelease(wrapper, 'Latest on GitHub')
    finishFolderCheck([])
    await flushPromises()
    expect(savedSetups(wrapper)).toEqual([])

    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()
    const [saved] = savedSetups(wrapper)
    expect(saved?.plan.selections.release?.value).toBe('latest')
    expect(saved?.plan.selections.comfyVersion).toBeUndefined()
  })

  it('holds Start from in first use until Desktop has picked a setup', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    let finishHardwareCheck: (result: { supported: boolean }) => void = () => {}
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        finishHardwareCheck = resolve
      })
    )
    const wrapper = mountModal({ hideBackToDashboard: true })
    const opening = wrapper.vm.open({ cameFromSetup: true, entrypoint: 'first_use' })
    await flushPromises()

    expect(startFromIsHeld(wrapper)).toBe(true)
    await startFrom(wrapper, ALREADY_HAVE)
    await startFrom(wrapper, NEW_INSTALL)
    finishHardwareCheck({ supported: true })
    await opening
    await flushPromises()

    expect(startFromIsHeld(wrapper)).toBe(false)
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-checked')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="config-save-changes"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('gives the name back as it was when Discard follows a name typed for a ComfyUI already there', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await wrapper.get('#inst-name-standalone').setValue('Studio')
    await showChangeSetup(wrapper)

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('#track-name').setValue('Old portable')
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()

    expect(wrapper.get<HTMLInputElement>('#inst-name-standalone').element.value).toBe('Studio')
  })

  it('shows a failed release load only beside the new install it belongs to', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('HTTP 503')
    )
    const wrapper = await openChangeSetup()
    expect(wrapper.get('.config-error').text()).toBe('HTTP 503')

    await startFrom(wrapper, ALREADY_HAVE)
    expect(wrapper.find('.config-error').exists()).toBe(false)
    await wrapper.get('[data-testid="existing-comfy-snapshot"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.config-error').exists()).toBe(false)

    await startFrom(wrapper, NEW_INSTALL)
    expect(wrapper.get('.config-error').text()).toBe('HTTP 503')
  })

  it('still has the folder that was picked after the other places and a new install were looked at', async () => {
    const api = mockPickedFolder()
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    const wrapper = await openChangeSetup()

    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('.track-location .config-path-browse').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="existing-comfy-snapshot"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()
    await startFrom(wrapper, NEW_INSTALL)
    await startFrom(wrapper, ALREADY_HAVE)

    expect(wrapper.get('.track-location button.config-path-open').text()).toBe('/home/user/Picked')
    await wrapper.get('[data-testid="config-use-existing"]').trigger('click')
    await flushPromises()
    expect(api.browseFolder).toHaveBeenCalledOnce()
    expect(api.trackInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ installPath: '/home/user/Picked' })
    )
  })

  it('only holds back a dropped file while the snapshot drop area is the one showing', async () => {
    const wrapper = await openChangeSetup()
    const dropIsHeldBack = (): boolean => {
      const drop = new Event('drop', { cancelable: true })
      document.dispatchEvent(drop)
      return drop.defaultPrevented
    }

    await startFrom(wrapper, ALREADY_HAVE)
    expect(dropIsHeldBack()).toBe(false)
    await wrapper.get('[data-testid="existing-comfy-snapshot"]').trigger('click')
    await flushPromises()
    expect(dropIsHeldBack()).toBe(true)

    await wrapper.get('[data-testid="existing-comfy-folder"]').trigger('click')
    await flushPromises()
    expect(dropIsHeldBack()).toBe(false)
    await wrapper.get('[data-testid="existing-comfy-snapshot"]').trigger('click')
    await flushPromises()
    expect(dropIsHeldBack()).toBe(true)
  })

  it('forgets the folder that was picked once the changes are discarded', async () => {
    mockPickedFolder()
    const wrapper = await openChangeSetup()
    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('.track-location .config-path-browse').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()
    await showChangeSetup(wrapper)
    await startFrom(wrapper, ALREADY_HAVE)

    expect(wrapper.find('.track-location button.config-path-open').exists()).toBe(false)
    expect(wrapper.get('[data-testid="config-use-existing"]').attributes('disabled')).toBeDefined()
  })

  it('holds Discard, the other places and Start from while a snapshot build is being created, then starts its install', async () => {
    const api = mockSnapshotFile()
    let finishCreating: (result: unknown) => void = () => {}
    api.createFromSnapshot = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCreating = resolve
        })
    )
    const wrapper = await openChangeSetup()
    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('[data-testid="existing-comfy-snapshot"]').trigger('click')
    await flushPromises()
    await wrapper.get('.load-snapshot-tertiary').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="config-use-existing"]').trigger('click')
    await flushPromises()

    const discard = wrapper.get('[data-testid="config-discard-changes"]')
    const folderCard = wrapper.get('[data-testid="existing-comfy-folder"]')
    expect(discard.attributes('disabled')).toBeDefined()
    expect(folderCard.attributes('disabled')).toBeDefined()
    expect(startFromIsHeld(wrapper)).toBe(true)
    await discard.trigger('click')
    await folderCard.trigger('click')
    await startFrom(wrapper, NEW_INSTALL)

    finishCreating({ ok: true, entry: { id: 'inst-1', name: 'Studio' } })
    await flushPromises()

    expect(wrapper.emitted('show-progress')).toEqual([
      [expect.objectContaining({ installationId: 'inst-1', opKind: 'install' })]
    ])
  })

  it('adds the folder once when Add build is pressed twice before the first press has finished', async () => {
    const api = mockPickedFolder()
    let finishTracking: (result: { ok: boolean }) => void = () => {}
    api.trackInstallation = vi.fn(
      () =>
        new Promise((resolve) => {
          finishTracking = resolve
        })
    )
    const wrapper = await openChangeSetup()
    await startFrom(wrapper, ALREADY_HAVE)
    await wrapper.get('.track-location .config-path-browse').trigger('click')
    await flushPromises()

    const addBuild = wrapper.get<HTMLButtonElement>('[data-testid="config-use-existing"]')
    addBuild.element.click()
    addBuild.element.click()
    await flushPromises()
    expect(addBuild.attributes('disabled')).toBeDefined()
    expect(
      wrapper.get('[data-testid="config-discard-changes"]').attributes('disabled')
    ).toBeDefined()

    finishTracking({ ok: true })
    await flushPromises()

    expect(api.trackInstallation).toHaveBeenCalledOnce()
    expect(wrapper.emitted('navigate-list')).toHaveLength(1)
  })

  it('holds Change until Desktop has picked a setup, so Discard goes back to that setup', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    mockReleaseOptions()
    let finishHardwareCheck: (result: { supported: boolean }) => void = () => {}
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        finishHardwareCheck = resolve
      })
    )
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    const change = wrapper.get('[data-testid="config-change-setup"]')
    expect(change.attributes('disabled')).toBeDefined()

    finishHardwareCheck({ supported: true })
    await flushPromises()
    expect(change.attributes('disabled')).toBeUndefined()

    await showChangeSetup(wrapper)
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()

    const summary = wrapper.get('[data-testid="config-summary"]').text()
    expect(summary).toContain('Stable')
    expect(summary).toContain('v0.4.2')
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeUndefined()
  })

  it('holds Change while the managed Builds are still loading', async () => {
    const status = { signedIn: true, workspaceId: 'personal-server-id', workspaceType: 'personal' }
    ;(window.api.comfybuilder.getAuthStatus as ReturnType<typeof vi.fn>).mockResolvedValue(status)
    let finishBuilds: (builds: unknown[]) => void = () => {}
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        finishBuilds = resolve
      })
    )
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    const change = wrapper.get('[data-testid="config-change-setup"]')
    expect(change.attributes('disabled')).toBeDefined()

    finishBuilds([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    await flushPromises()
    expect(change.attributes('disabled')).toBeUndefined()

    await showChangeSetup(wrapper)
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="config-summary"]').text()).toContain('Ready Build')
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeUndefined()
  })

  it('restarts a field load that Discard interrupted so Install comes back', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    let versionCalls = 0
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockImplementation(
      async (_source: string, fieldId: string) => {
        if (fieldId === 'release') return [{ value: 'stable', label: 'Stable', recommended: true }]
        versionCalls++
        if (versionCalls === 1) return new Promise(() => {})
        return [{ value: 'v0.4.2', label: 'v0.4.2', recommended: true }]
      }
    )
    const wrapper = await openChangeSetup()
    expect(versionCalls).toBe(1)

    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()

    expect(versionCalls).toBe(2)
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeUndefined()
  })

  it('stops loading when Discard cancels a managed Builds load started with no source picked', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    ;(window.api.validateHardware as ReturnType<typeof vi.fn>).mockResolvedValue({
      supported: false,
      error: 'This CPU is missing AVX support.'
    })
    ;(window.api.comfybuilder.signIn as ReturnType<typeof vi.fn>).mockResolvedValue({
      signedIn: true,
      workspaceId: 'personal-server-id',
      workspaceType: 'personal'
    })
    let finishBuilds: (builds: unknown[]) => void = () => {}
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        finishBuilds = resolve
      })
    )
    const wrapper = await openChangeSetup()

    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()
    finishBuilds([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    await flushPromises()

    expect(wrapper.find('.config-loading').exists()).toBe(false)
  })

  it('drops the sign-in wait on Discard and reuses the open sign-in when Managed is picked again', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    mockReleaseOptions()
    let finishSignIn: (status: unknown) => void = () => {}
    ;(window.api.comfybuilder.signIn as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        finishSignIn = resolve
      })
    )
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ready', name: 'Ready Build', state: 'installable' }
    ])
    const wrapper = await openChangeSetup()
    const managedCard = () => wrapper.get('[data-testid="workspace-install-source-managed"]')

    await managedCard().trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="workspace-authorization-status"]').exists()).toBe(true)

    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="workspace-authorization-status"]').exists()).toBe(false)
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeUndefined()

    await showChangeSetup(wrapper)
    expect(managedCard().attributes('disabled')).toBeUndefined()
    await managedCard().trigger('click')
    await flushPromises()
    finishSignIn({ signedIn: true, workspaceId: 'personal-server-id', workspaceType: 'personal' })
    await flushPromises()

    expect(window.api.comfybuilder.signIn).toHaveBeenCalledOnce()
    expect(managedCard().attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-testid="workspace-build-field"]').text()).toContain('Ready Build')
  })

  it('moves between sources with the arrow keys without signing in, and picks hardware as it moves', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'nvidia', label: 'NVIDIA', recommended: true, data: { variantId: 'win-nvidia' } },
      { value: 'cpu', label: 'CPU', data: { variantId: 'win-cpu' } }
    ])
    const wrapper = mountModal({}, { attachTo: document.body })
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await showChangeSetup(wrapper)

    await wrapper
      .get('[data-testid="install-source-standalone"]')
      .trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="workspace-install-source-managed"]').element
    )
    expect(window.api.comfybuilder.signIn).not.toHaveBeenCalled()

    const hardware = wrapper.get('#source-fields [role="radiogroup"]')
    await hardware.findAll('[role="radio"]')[0]!.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="config-summary"]').text()).toContain('CPU')
    wrapper.unmount()
  })

  it('hides the close button in Change setup so Discard and Save changes are the only ways back', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    mockReleaseOptions()
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    expect(wrapper.find('.setup-modal-close').exists()).toBe(true)

    await showChangeSetup(wrapper)
    expect(wrapper.find('.setup-modal-close').exists()).toBe(false)

    await wrapper.get('[data-testid="config-discard-changes"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.setup-modal-close').exists()).toBe(true)
  })

  it('keeps the edits when Save changes is pressed', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([releaseSource])
    mockReleaseOptions()
    const wrapper = await openChangeSetup()

    await pickRelease(wrapper, 'Latest on GitHub')
    await wrapper.get('[data-testid="config-save-changes"]').trigger('click')

    expect(wrapper.get('[data-testid="config-summary"]').text()).toContain('Latest on GitHub')
    expect(wrapper.get('.config-continue').text()).toBe('Install')
  })

  it('puts Location before Hardware and draws hardware with an icon', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'variant', label: 'Hardware', type: 'select', renderAs: 'cards' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'mps', label: 'Apple Silicon (MPS)', recommended: true, data: { variantId: 'mps' } }
    ])
    const wrapper = await openChangeSetup()

    const rows = wrapper.findAll('#source-fields > *')
    expect(
      rows.map((row) => row.attributes('data-testid') ?? row.get('.config-label').text())
    ).toEqual(['install-location-field', 'Hardware'])
    expect(wrapper.find('.setup-option__icon img').exists()).toBe(false)
    expect(wrapper.find('.setup-option__icon svg').exists()).toBe(true)
  })

  it('asks for the folder or the snapshot inside Change setup, with no second window', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    const wrapper = await openChangeSetup()
    expect(wrapper.get('.setup-modal-lead').text()).toBe(
      'Everything here is already set to what fits this computer.'
    )

    await startFrom(wrapper, ALREADY_HAVE)

    expect(wrapper.get('.setup-modal-lead').text()).toBe(
      'Point Desktop at the ComfyUI you already have.'
    )
    expect(existingComfyCards(wrapper)).toEqual([
      'On this computer',
      'On a server',
      'In a snapshot file'
    ])
    expect(wrapper.get('[data-testid="existing-comfy-folder"]').attributes('aria-checked')).toBe(
      'true'
    )
    const form = wrapper.get('[data-testid="config-change-form"]')
    expect(form.findAll('.config-label').map((label) => label.text())).toEqual([
      'Start from',
      'Where it is',
      'Install location',
      'Name',
      'Detected type'
    ])
    expect(wrapper.get('[data-testid="config-use-existing"]').text()).toBe('Add build')
    expect(wrapper.find('[data-testid="config-save-changes"]').exists()).toBe(false)

    await wrapper.get('[data-testid="existing-comfy-snapshot"]').trigger('click')
    await flushPromises()

    expect(form.find('.load-snapshot-dropzone').exists()).toBe(true)
    expect(form.find('.track-form').exists()).toBe(false)
    expect(wrapper.get('[data-testid="config-use-existing"]').text()).toBe('Create build')
    expect(wrapper.find('[data-testid="track-modal"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="load-snapshot-modal"]').exists()).toBe(false)

    await startFrom(wrapper, NEW_INSTALL)

    expect(form.find('.load-snapshot-dropzone').exists()).toBe(false)
    expect(wrapper.get('[data-testid="config-save-changes"]').text()).toBe('Save changes')
  })

  it('offers only a server as the ComfyUI already there in first use, and connects to it once the EULA is agreed', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      releaseSource,
      remoteSource
    ])
    mockReleaseOptions()
    ;(window.api.buildInstallation as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceId: 'remote'
    })
    const wrapper = mountModal({ hideBackToDashboard: true })
    await wrapper.vm.open({ cameFromSetup: true, needsConsent: true, entrypoint: 'first_use' })
    await flushPromises()

    await startFrom(wrapper, ALREADY_HAVE)

    expect(existingComfyCards(wrapper)).toEqual(['On a server'])
    expect(wrapper.get('[data-testid="install-source-remote"]').attributes('aria-checked')).toBe(
      'true'
    )
    expect(wrapper.find('.track-form').exists()).toBe(false)
    expect(wrapper.find('[data-testid="config-save-changes"]').exists()).toBe(false)
    const connect = wrapper.get('[data-testid="config-use-existing"]')
    expect(connect.text()).toBe('Connect')

    await connect.trigger('click')
    await flushPromises()
    expect(window.api.addInstallation).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="config-consent-tos"]').attributes('data-nudge')).toBe('true')

    await wrapper.get('[data-testid="config-consent-tos"] [role="checkbox"]').trigger('click')
    await flushPromises()
    await connect.trigger('click')
    await flushPromises()

    expect(window.api.addInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'remote', status: 'installed', installPath: '' })
    )
    expect(wrapper.emitted('navigate-list')).toHaveLength(1)
  })
})
