import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'

import { en } from '../lib/i18nMessages.ts'
import InstallWizardModal from './InstallWizardModal.vue'
import BaseSelect from '../components/ui/BaseSelect.vue'
import BrandVariantList from '../components/BrandVariantList.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountModal() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(InstallWizardModal, {
    global: {
      plugins: [makeI18n(), pinia],
      stubs: { BrandTakeoverLayout: { template: '<div><slot /></div>' } }
    }
  })
}

beforeEach(() => {
  window.api = {
    openPath: vi.fn().mockResolvedValue(undefined),
    browseFolder: vi.fn().mockResolvedValue('/home/user/Picked'),
    detectGPU: vi.fn().mockResolvedValue(null),
    getDefaultInstallDir: vi.fn().mockResolvedValue('/home/user/ComfyUI'),
    getSources: vi.fn().mockResolvedValue([]),
    getFieldOptions: vi.fn().mockResolvedValue([]),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSetting: vi.fn().mockResolvedValue(false),
    getInstallationsSummary: vi.fn().mockResolvedValue({ localCount: 0 }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    getDiskSpace: vi.fn().mockResolvedValue(null),
    validateInstallPath: vi.fn().mockResolvedValue([]),
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
  it('uses the new-instance title and local-install subtitle', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.get('.brand-title').text()).toBe('Create a New Instance')
    expect(wrapper.get('.brand-lead').text()).toBe('Set up a fresh ComfyUI environment.')
  })
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
    return wrapper
  }

  it('shows compatible Builds even when their releases are already installed', async () => {
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

    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes()
    ).toMatchObject({ 'aria-checked': 'true' })
    expect(
      wrapper.get('[data-testid="workspace-install-source-public"]').attributes()
    ).toMatchObject({ 'aria-checked': 'false' })
    expect(wrapper.find('.config-advanced').exists()).toBe(false)
    const buildSelect = wrapper.getComponent(BaseSelect)
    expect(buildSelect.props('options')).toEqual([
      { value: 'ready', label: 'Ready Build' },
      { value: 'installed', label: 'Installed Build' },
      { value: 'linked', label: 'Linked Build' },
      { value: 'update', label: 'Updated Build' }
    ])
    expect(buildSelect.props('modelValue')).toBe('ready')
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

  it('reuses the loaded catalog on repeat opens and refreshes only on request', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    const wrapper = mountModal()
    await flushPromises()
    const open = (opts: { workspaceId: string }): Promise<void> =>
      (wrapper.vm as unknown as { open: (options: { workspaceId: string }) => Promise<void> }).open(
        opts
      )

    await open({ workspaceId: 'w1' })
    await flushPromises()
    await open({ workspaceId: 'w1' })
    await flushPromises()

    expect(window.api.comfybuilder.switchWorkspace).not.toHaveBeenCalled()
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
    expect(wrapper.getComponent(BaseSelect).props('modelValue')).toBe('ready')

    let finishRefresh!: (builds: Array<Record<string, unknown>>) => void
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRefresh = resolve
      })
    )
    await wrapper.get('.workspace-build-refresh').trigger('click')
    expect(wrapper.getComponent(BaseSelect).get('.ui-select-label').text()).toBe(
      'Refreshing builds...'
    )
    expect(wrapper.getComponent(BaseSelect).props('disabled')).toBe(false)
    finishRefresh([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    await flushPromises()
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledTimes(2)
    expect(wrapper.getComponent(BaseSelect).get('.ui-select-label').text()).toBe('Ready Build')
  })

  it('uses the existing local installer and template picker for Public builds', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'bundledTemplate', label: 'Starter Template', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'none', label: 'None' },
      { value: 'starter', label: 'Starter Workflow' }
    ])
    const wrapper = await openWorkspaceModal()

    expect(wrapper.get('[data-testid="workspace-install-source-managed"]').text()).toBe('Managed')
    expect(wrapper.get('[data-testid="workspace-install-source-public"]').text()).toBe('Public')

    await wrapper.get('[data-testid="workspace-install-source-public"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.brand-lead').text()).toBe('Set up a fresh ComfyUI environment.')
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
    expect(wrapper.get('.config-advanced').exists()).toBe(true)
    expect(window.api.getFieldOptions).toHaveBeenCalledWith(
      'standalone',
      'bundledTemplate',
      {},
      undefined
    )

    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(wrapper.get('.template-shell').exists()).toBe(true)
    expect(window.api.comfybuilder.installBuild).not.toHaveBeenCalled()
  })

  it('switches back to cached Managed builds without another catalog request', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
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

    await wrapper.get('[data-testid="workspace-install-source-public"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(PathDiskInfo).props('estimatedSize')).toBe(2_250)

    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.brand-lead').text()).toBe('Select a release to install.')
    expect(wrapper.get('[data-testid="workspace-build-field"]').exists()).toBe(true)
    expect(wrapper.find('.config-advanced').exists()).toBe(false)
    expect(wrapper.getComponent(PathDiskInfo).props('estimatedSize')).toBe(0)
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
  })

  it('opens the selected workspace Builds page online', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    const wrapper = await openWorkspaceModal()

    await wrapper.get('.workspace-build-online').trigger('click')

    expect(window.api.comfybuilder.openBuildsPage).toHaveBeenCalledExactlyOnceWith('w1')
    expect(wrapper.get('.workspace-build-online').text()).toBe('View builds online')
  })

  it('shows an empty state when no compatible Builds can be installed', async () => {
    signInToWorkspace([{ id: 'none', name: 'No Build Yet', state: 'no-build' }])
    const wrapper = await openWorkspaceModal()

    expect(wrapper.get('.brand-lead').text()).toBe('Select a release to install.')
    expect(wrapper.get('[data-testid="workspace-build-field"]').text()).toContain(
      'No compatible Builds are available to install.'
    )
    expect(wrapper.get('.config-continue').attributes('disabled')).toBeDefined()
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

    expect(window.api.comfybuilder.switchWorkspace).toHaveBeenCalledExactlyOnceWith('w2')
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

  it('installs the selected Build with the requested name and install root', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    ;(window.api.comfybuilder.installBuild as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: { id: 'managed-1', name: 'My Managed Instance' }
    })
    const wrapper = await openWorkspaceModal()
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
    expect(wrapper.get('[data-testid="workspace-build-targets"]').isVisible()).toBe(true)
    const targetPicker = wrapper.getComponent(BrandVariantList)
    expect(targetPicker.props('options')).toEqual([
      {
        value: 'cuda',
        label: 'Windows - NVIDIA (CUDA 12.8)',
        description: 'Release v3',
        recommended: true,
        data: { variantId: 'win-nvidia-cu128' }
      },
      {
        value: 'cpu',
        label: 'Windows - CPU',
        description: 'Release v3',
        recommended: false,
        data: { variantId: 'win-cpu-cpu' }
      }
    ])
    expect(targetPicker.props('selectedValue')).toBe('cuda')

    await targetPicker.findAll('button')[1]!.trigger('click')
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
})

describe('InstallWizardModal hardware warning', () => {
  const KFD_WARNING =
    'Your user cannot access the AMD GPU compute interface (/dev/kfd), so ComfyUI will not be able to use the GPU.'
  const standaloneSource = { id: 'standalone', label: 'Standalone', fields: [] }
  const remoteSource = { id: 'remote', label: 'Remote Connection', skipInstall: true, fields: [] }

  it('renders the validateHardware warning under the detected GPU field', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([standaloneSource])
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
    const advanced = wrapper.get('.config-advanced').element
    const gpuField = wrapper.get('[data-testid="detected-gpu-field"]').element
    expect(advanced.compareDocumentPosition(gpuField) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0
    )
  })

  it('renders no warning element when validateHardware reports none', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([standaloneSource])
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(false)
  })

  it('suppresses the warning for a skipInstall (remote) source', async () => {
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

    // Standalone is auto-selected; the warning shows.
    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(true)

    const remotePill = wrapper
      .findAll('button[role="radio"]')
      .find((b) => b.text().includes('Remote Connection'))
    expect(remotePill).toBeTruthy()
    await remotePill!.trigger('click')
    await flushPromises()

    // Remote installs run on other hardware; local GPU access is irrelevant.
    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(false)
  })
})
