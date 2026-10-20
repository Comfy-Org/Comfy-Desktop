import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'

import { en } from '../lib/i18nMessages.ts'
import InstallWizardModal from './InstallWizardModal.vue'
import Select from '../design-system/components/Select.vue'
import OptionCards from '../design-system/components/OptionCards.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'
import { useModal } from '../composables/useModal'
import { useAuthStore } from '../stores/authStore'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountModal() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(InstallWizardModal, {
    global: {
      plugins: [makeI18n(), pinia],
      stubs: {
        TakeoverPage: {
          template: '<div><slot /><slot name="footer-left" /><slot name="footer" /></div>'
        }
      }
    }
  })
}

/** A design-system Button, found by its visible text. */
function getButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`No button with text "${text}"`)
  return button
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
  it('uses the new-instance title and local-install subtitle', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    expect(wrapper.get('header h1').text()).toBe('Create a New Build')
    expect(wrapper.get('header p').text()).toBe('Set up a fresh ComfyUI environment.')
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

    // The source's fields show directly (no collapsed "advanced" section).
    const fieldLabel = wrapper.findAll('label').find((l) => l.text() === 'ComfyUI version')
    expect(fieldLabel?.isVisible()).toBe(true)
    const versionSelect = wrapper.getComponent(Select)
    expect(versionSelect.isVisible()).toBe(true)
    expect(versionSelect.props('ariaLabel')).toBe('ComfyUI version')
    expect(versionSelect.props('options')).toEqual([{ value: 'stable', label: 'Stable' }])
    expect(
      wrapper
        .get('[data-testid="install-source-tabs"]')
        .findAll('button')
        .map((button) => button.text())
    ).toEqual(['Public Builds', 'Managed Builds'])
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-pressed')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-pressed')
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

    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.signIn).toHaveBeenCalledOnce()
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-pressed')
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

describe('InstallWizardModal starter template disk gate', () => {
  async function openTemplateStep(modelsPresent: boolean) {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'standalone',
        label: 'Standalone',
        fields: [{ id: 'bundledTemplate', label: 'Starter Template', type: 'select' }]
      }
    ])
    ;(window.api.getFieldOptions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 'none', label: 'None' },
      {
        value: 'starter',
        label: 'Starter Workflow',
        recommended: true,
        data: { modality: 'image', sizeBytes: 20_000_000_000, modelsPresent }
      }
    ])
    ;(window.api.getDiskSpace as ReturnType<typeof vi.fn>).mockResolvedValue({
      free: 1_000_000_000,
      total: 1_000_000_000_000
    })
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    await wrapper.get('.config-continue').trigger('click')
    // The disk-space probe is debounced.
    await vi.waitFor(() => expect(window.api.getDiskSpace).toHaveBeenCalled(), { timeout: 5000 })
    await flushPromises()
    // Nothing is pre-selected: the user picks the card.
    await wrapper.get('.tps__card').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('blocks a template whose models do not fit on disk', async () => {
    const wrapper = await openTemplateStep(false)

    expect(wrapper.get('.template-install').attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('#tps-alerts [role="alert"]').exists()).toBe(true)
  })

  it('lets a template whose models are already downloaded install on a full disk', async () => {
    const wrapper = await openTemplateStep(true)

    expect(wrapper.get('.template-install').attributes('aria-disabled')).toBe('false')
    expect(wrapper.find('#tps-alerts [role="alert"]').exists()).toBe(false)
  })
})

describe('InstallWizardModal install-location field', () => {
  it('renders the default install location as a clickable path that opens the folder', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    const field = wrapper.get('[data-testid="install-location-field"]')
    expect(field.get('span').text()).toBe('Install location')
    const pathBtn = getButtonByText(wrapper, '/home/user/ComfyUI')
    expect(field.element.contains(pathBtn.element)).toBe(true)
    expect(pathBtn.attributes('aria-label')).toBe('Open Directory: /home/user/ComfyUI')

    await pathBtn.trigger('click')
    expect(window.api.openPath).toHaveBeenCalledWith('/home/user/ComfyUI')
  })

  it('renders a blank install location as inert (non-clickable, never opens a folder)', async () => {
    ;(window.api.getDefaultInstallDir as ReturnType<typeof vi.fn>).mockResolvedValue('')
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()

    // Only the Browse button remains; the blank path is plain text.
    const field = wrapper.get('[data-testid="install-location-field"]')
    expect(field.findAll('button').map((button) => button.text())).toEqual(['Browse…'])
    expect(field.find('button[aria-label^="Open Directory"]').exists()).toBe(false)
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
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] },
      { id: 'portable', label: 'Portable', fields: [] },
      { id: 'remote', label: 'Remote Connection', fields: [] }
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

    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes()
    ).toMatchObject({ 'aria-pressed': 'true' })
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-pressed')
    ).toBe('false')
    expect(
      wrapper
        .get('[data-testid="install-source-tabs"]')
        .findAll('button')
        .map((button) => button.text())
    ).toEqual(['Public Builds', 'Managed Builds', 'Remote Connection', 'Portable'])
    expect(wrapper.get('[data-testid="install-source-tabs"]').text()).not.toContain('RECOMMENDED')
    expect(wrapper.find('[data-testid="workspace-install-source-public"]').exists()).toBe(false)
    // Only the Build picker shows: no local source fields.
    expect(wrapper.find('label[for^="sf-"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="workspace-build-field"] span').text()).toBe('Release')
    const buildSelect = wrapper.getComponent(Select)
    expect(buildSelect.props('ariaLabel')).toBe('Release')
    expect(buildSelect.props('options')).toEqual([
      { value: 'ready', label: 'Ready Build' },
      { value: 'installed', label: 'Installed Build' },
      { value: 'linked', label: 'Linked Build' },
      { value: 'update', label: 'Updated Build' }
    ])
    expect(buildSelect.props('modelValue')).toBe('ready')
  })

  it('switches directly from Managed to a peer source tab', async () => {
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

    await wrapper.get('[data-testid="install-source-remote"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-pressed')
    ).toBe('false')
    expect(wrapper.get('[data-testid="install-source-remote"]').attributes('aria-pressed')).toBe(
      'true'
    )
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
    expect(wrapper.get('label[for="sf-url"]').text()).toBe('Server URL')
    expect(wrapper.find('input#sf-url').exists()).toBe(true)
    expect(window.api.getFieldOptions).not.toHaveBeenCalled()
    expect(window.api.validateHardware).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()

    expect(window.api.validateHardware).toHaveBeenCalledOnce()
    expect(window.api.getFieldOptions).toHaveBeenCalledOnce()
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

    expect(wrapper.getComponent(Select).props('options')).toEqual([
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
    expect(wrapper.getComponent(Select).props('options')).toEqual([
      { value: 'ready', label: 'Ready Build', description: 'Release v2' }
    ])
    ;(window.api.comfybuilder.listBuilds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ready', name: 'Ready Build', version: '3', state: 'installable' }
    ])
    await open({ workspaceId: 'w1' })
    await flushPromises()

    expect(window.api.comfybuilder.switchWorkspace).not.toHaveBeenCalled()
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledTimes(2)
    expect(wrapper.getComponent(Select).props('modelValue')).toBe('ready')
    expect(wrapper.getComponent(Select).props('options')).toEqual([
      { value: 'ready', label: 'Ready Build', description: 'Release v3' }
    ])
  })

  it('uses the existing local installer and template picker for Standalone', async () => {
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

    expect(wrapper.get('[data-testid="workspace-install-source-managed"]').text()).toBe(
      'Managed Builds'
    )
    expect(wrapper.find('[data-testid="workspace-install-source-public"]').exists()).toBe(false)

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('header p').text()).toBe('Set up a fresh ComfyUI environment.')
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
    // The local source's own fields render directly in place of the Build picker.
    expect(wrapper.findAll('label').some((l) => l.text() === 'Starter Template')).toBe(true)
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

    expect(window.api.comfybuilder.switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.getComponent(Select).props('options')).toEqual([
      { value: 'ready', label: 'Personal Build' }
    ])

    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()
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

    expect(wrapper.get('header p').text()).toBe('Set up a fresh ComfyUI environment.')
    expect(wrapper.get('[data-testid="workspace-build-field"]').exists()).toBe(true)
    expect(wrapper.find('label[for^="sf-"]').exists()).toBe(false)
    expect(wrapper.getComponent(PathDiskInfo).props('estimatedSize')).toBe(4_500)
    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
  })

  it('never shows the template picker for a Managed install after visiting the Public tab', async () => {
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
    ;(window.api.comfybuilder.installBuild as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      entry: { id: 'managed-1', name: 'Ready Build' }
    })
    const wrapper = await openWorkspaceModal()

    // Visit Standalone (loads template options), then return to Managed.
    await wrapper.get('[data-testid="install-source-standalone"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="workspace-install-source-managed"]').trigger('click')
    await flushPromises()

    await wrapper.get('.config-continue').trigger('click')
    await flushPromises()

    expect(wrapper.find('.template-shell').exists()).toBe(false)
    expect(window.api.comfybuilder.installBuild).toHaveBeenCalledOnce()
  })

  it('opens the selected workspace Builds page online', async () => {
    signInToWorkspace([{ id: 'ready', name: 'Ready Build', state: 'installable' }])
    const wrapper = await openWorkspaceModal()

    await getButtonByText(wrapper, 'View builds online').trigger('click')

    expect(window.api.comfybuilder.openBuildsPage).toHaveBeenCalledExactlyOnceWith('w1')
  })

  it('defaults to Public Builds when no managed Build is compatible with this machine', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    signInToWorkspace([{ id: 'linux', name: 'Linux Build', state: 'platform-mismatch' }])
    const wrapper = await openWorkspaceModal()

    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-pressed')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-pressed')
    ).toBe('false')
    expect(wrapper.find('[data-testid="workspace-build-field"]').exists()).toBe(false)
  })

  it('defaults to Public Builds when the workspace has no managed Builds', async () => {
    ;(window.api.getSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'standalone', label: 'Standalone', fields: [] }
    ])
    signInToWorkspace([])
    const wrapper = await openWorkspaceModal()

    expect(wrapper.get('header p').text()).toBe('Set up a fresh ComfyUI environment.')
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-pressed')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="workspace-install-source-managed"]').attributes('aria-pressed')
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

    expect(window.api.comfybuilder.listBuilds).not.toHaveBeenCalled()
    expect(
      wrapper.get('[data-testid="install-source-standalone"]').attributes('aria-pressed')
    ).toBe('true')
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
    expect(wrapper.getComponent(Select).props('options')).toEqual([
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

    await getButtonByText(wrapper, "Couldn't load builds. Retry").trigger('click')
    await flushPromises()

    expect(window.api.comfybuilder.listBuilds).toHaveBeenCalledTimes(2)
    expect(wrapper.getComponent(Select).props('options')).toEqual([
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

    expect(wrapper.find('label[for^="sf-"]').exists()).toBe(false)
    const targetSection = wrapper.get('[data-testid="workspace-build-targets"]')
    expect(targetSection.isVisible()).toBe(true)
    expect(targetSection.get('span').text()).toBe('Hardware')
    const targetPicker = wrapper.getComponent(OptionCards)
    expect(targetPicker.props('label')).toBe('Hardware')
    expect(targetPicker.props('options')).toMatchObject([
      {
        value: 'cuda',
        label: 'Windows - NVIDIA (CUDA 12.8)',
        description: 'Release v3',
        tags: [{ label: 'Recommended' }]
      },
      {
        value: 'cpu',
        label: 'Windows - CPU',
        description: 'Release v3',
        tags: []
      }
    ])
    const cards = targetPicker.findAll('[data-testid="option-card"]')
    expect(cards.map((card) => card.get('[data-testid="option-card-label"]').text())).toEqual([
      'Windows - NVIDIA (CUDA 12.8)',
      'Windows - CPU'
    ])
    expect(cards.map((card) => card.attributes('aria-checked'))).toEqual(['true', 'false'])

    await cards[1]!.trigger('click')
    expect(targetPicker.props('modelValue')).toBe('cpu')
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
    const sourceTabs = wrapper.get('[data-testid="install-source-tabs"]').element
    const installLocation = wrapper.get('[data-testid="install-location-field"]').element
    const gpuField = wrapper.get('[data-testid="detected-gpu-field"]').element
    expect(
      sourceTabs.compareDocumentPosition(installLocation) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
    expect(installLocation.contains(gpuField)).toBe(true)
    // The GPU sits beside the disk info, with the warning below it.
    expect(
      gpuField.compareDocumentPosition(warning.element) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
    expect(gpuField.textContent).toBe('detected GPU: Radeon RX 7900')
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

    const remotePill = wrapper.get('[data-testid="install-source-remote"]')
    expect(remotePill.text()).toBe('Remote Connection')
    await remotePill.trigger('click')
    await flushPromises()

    // Remote installs run on other hardware; local GPU access is irrelevant.
    expect(wrapper.find('[data-testid="wizard-hardware-warning"]').exists()).toBe(false)
  })
})
