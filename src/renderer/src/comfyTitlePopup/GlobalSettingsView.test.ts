import { describe, expect, it, beforeEach } from 'vitest'
import { DOMWrapper, mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

import { useModal } from '../composables/useModal'
import GlobalSettingsView from './GlobalSettingsView.vue'

interface RemoveAppDataOptions {
  deleteInstances: boolean
  deleteModels: boolean
  deleteInputOutput: boolean
}

interface BridgeState {
  updateFieldCalls: Array<{ id: string; value: unknown }>
  setModelsDirsCalls: string[][]
  openPathCalls: string[]
  openExternalCalls: string[]
  openLogsFolderCalls: number
  browseFolderReturn: string | null
  checkForUpdateCalls: number
  downloadUpdateCalls: number
  installUpdateCalls: number
  removeAppDataCalls: RemoveAppDataOptions[]
  closeCalls: number
}

function installMockBridge(): BridgeState {
  const state: BridgeState = {
    updateFieldCalls: [],
    setModelsDirsCalls: [],
    openPathCalls: [],
    openExternalCalls: [],
    openLogsFolderCalls: 0,
    browseFolderReturn: null,
    checkForUpdateCalls: 0,
    downloadUpdateCalls: 0,
    installUpdateCalls: 0,
    removeAppDataCalls: [],
    closeCalls: 0
  }
  const bridge = {
    close: () => {
      state.closeCalls += 1
    },
    globalSettingsUpdateField: async (id: string, value: unknown) => {
      state.updateFieldCalls.push({ id, value })
      return { ok: true }
    },
    globalSettingsBrowseFolder: async () => state.browseFolderReturn,
    globalSettingsOpenPath: (path: string) => {
      state.openPathCalls.push(path)
    },
    globalSettingsOpenExternal: (url: string) => {
      state.openExternalCalls.push(url)
    },
    globalSettingsOpenLogsFolder: () => {
      state.openLogsFolderCalls += 1
    },
    globalSettingsSetModelsDirs: async (dirs: string[]) => {
      state.setModelsDirsCalls.push([...dirs])
      return { ok: true }
    },
    globalSettingsCheckForUpdate: async () => {
      state.checkForUpdateCalls += 1
      return { available: false }
    },
    globalSettingsDownloadUpdate: async () => {
      state.downloadUpdateCalls += 1
    },
    globalSettingsInstallUpdate: () => {
      state.installUpdateCalls += 1
    },
    globalSettingsSetLastCheckedAt: () => {},
    globalSettingsRemoveAppData: (options: RemoveAppDataOptions) => {
      state.removeAppDataCalls.push({ ...options })
    }
  }
  ;(window as unknown as { __comfyTitlePopup: typeof bridge }).__comfyTitlePopup = bridge
  return state
}

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    generalFields: [
      {
        id: 'language',
        label: 'Language',
        value: 'en',
        editable: true,
        editType: 'select',
        options: [
          { value: 'en', label: 'English' },
          { value: 'zh', label: '中文' }
        ]
      }
    ],
    telemetryFields: [
      {
        id: 'telemetryEnabled',
        label: 'Send anonymous telemetry',
        value: true,
        editable: true,
        editType: 'boolean'
      },
      {
        id: 'betaFeaturesEnabled',
        label: 'Opt-in to beta features',
        value: true,
        editable: true,
        editType: 'boolean'
      }
    ],
    telemetryGranted: true,
    desktopUpdateFields: [
      {
        id: 'autoInstallUpdates',
        label: 'Auto install updates',
        value: true,
        editable: true,
        editType: 'boolean'
      }
    ],
    cacheFields: [],
    advancedFields: [],
    sharedDirectoriesFields: [],
    installLocationFields: [
      {
        id: 'installDir',
        label: 'Install Location',
        value: '/home/u/ComfyUI-Installs',
        editable: true,
        editType: 'path',
        openable: true,
        browseOnly: true
      }
    ],
    modelsDirs: [
      { path: '/home/u/ComfyUI/models', isPrimary: true },
      { path: '/mnt/extra/models', isPrimary: false }
    ],
    modelsSystemDefault: '/home/u/ComfyUI/models',
    appUpdate: {
      state: { kind: null, version: null, autoUpdate: true },
      progress: null,
      isDownloading: false,
      capabilities: { systemManaged: false, canSelfUpdate: true },
      installedVersion: '1.2.3',
      platform: 'darwin',
      lastCheckedAt: null
    },
    githubUrl: 'https://github.com/comfyanonymous/ComfyUI',
    githubStars: 12345,
    i18n: {
      overview: 'General',
      updates: 'Updates',
      storage: 'Folders',
      models: 'Models',
      advanced: 'Advanced',
      logs: 'Logs',
      sharedDirectories: 'Shared directories'
    }
  }
  return { ...base, ...overrides }
}

function mountView(snapshot = makeSnapshot()) {
  return mount(GlobalSettingsView, {
    props: { snapshot: snapshot as never },
    attachTo: document.body
  })
}

function menuItems() {
  return [...document.querySelectorAll<HTMLElement>('.shared-folder-menu [role="menuitem"]')].map(
    (el) => new DOMWrapper(el)
  )
}

describe('GlobalSettingsView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders all five tabs and the general tab is active by default', () => {
    installMockBridge()
    const wrapper = mountView()
    const tabLabels = wrapper.findAll('.gs-tab').map((t) => t.text())
    expect(tabLabels).toEqual(['General', 'Updates', 'Folders', 'Advanced', 'Logs'])
    expect(wrapper.find('.gs-tab.active').text()).toBe('General')
  })

  it('keeps a requested tab when the popup refocuses the tab that had focus before', async () => {
    installMockBridge()
    const wrapper = mountView()
    await flushPromises()
    wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Updates')!
      .element.focus()
    await flushPromises()
    expect(wrapper.find('.gs-tab.active').text()).toBe('Updates')

    await wrapper.setProps({ snapshot: makeSnapshot({ initialTab: 'storage' }) as never })
    await flushPromises()
    document.activeElement!.dispatchEvent(new FocusEvent('focus'))
    await flushPromises()

    expect(wrapper.find('.gs-tab.active').text()).toBe('Folders')
    expect(wrapper.findAll('.gs-tab[tabindex="0"]').map((t) => t.text())).not.toContain('Updates')
  })

  it('moves focus with arrow-key tab navigation', async () => {
    installMockBridge()
    const wrapper = mountView()
    await flushPromises()
    const generalTab = wrapper.findAll('.gs-tab')[0]!
    generalTab.element.focus()
    await generalTab.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()

    const updatesTab = wrapper.findAll('.gs-tab')[1]!
    expect(wrapper.find('.gs-tab.active').text()).toBe('Updates')
    expect(document.activeElement).toBe(updatesTab.element)
  })

  it('lands on the tab named by snapshot.initialTab', () => {
    installMockBridge()
    const wrapper = mountView(makeSnapshot({ initialTab: 'storage' }))
    expect(wrapper.find('.gs-tab.active').text()).toBe('Folders')
  })

  describe('settings deep-link highlight', () => {
    const row = (id: string): HTMLElement | null =>
      document.querySelector(`[data-field-id="${id}"]`)

    it('flashes the field the snapshot names, on the tab it lives on', async () => {
      installMockBridge()
      const wrapper = mountView(
        makeSnapshot({ initialTab: 'general', highlightFieldId: 'betaFeaturesEnabled' })
      )
      await flushPromises()
      expect(wrapper.find('.gs-tab.active').text()).toBe('General')
      expect(row('betaFeaturesEnabled')?.classList.contains('gs-field-flash')).toBe(true)
    })

    it("moves keyboard focus to the flashed field's control", async () => {
      installMockBridge()
      mountView(makeSnapshot({ initialTab: 'general', highlightFieldId: 'betaFeaturesEnabled' }))
      await flushPromises()
      const control = row('betaFeaturesEnabled')?.querySelector('button')
      expect(control).toBeTruthy()
      expect(document.activeElement).toBe(control)
    })

    it('flashes nothing when the snapshot names no field', async () => {
      installMockBridge()
      mountView(makeSnapshot({ initialTab: 'general' }))
      await flushPromises()
      expect(document.querySelector('.gs-field-flash')).toBeNull()
    })

    it('does not re-flash on a null-highlight rebroadcast', async () => {
      installMockBridge()
      const wrapper = mountView(
        makeSnapshot({ initialTab: 'general', highlightFieldId: 'betaFeaturesEnabled' })
      )
      await flushPromises()
      row('betaFeaturesEnabled')!.classList.remove('gs-field-flash')

      await wrapper.setProps({
        snapshot: makeSnapshot({ initialTab: null, highlightFieldId: null }) as never
      })
      await flushPromises()
      expect(row('betaFeaturesEnabled')?.classList.contains('gs-field-flash')).toBe(false)
    })

    it('survives a field id that matches no row', async () => {
      installMockBridge()
      mountView(makeSnapshot({ initialTab: 'general', highlightFieldId: 'noSuchField' }))
      await flushPromises()
      expect(document.querySelector('.gs-field-flash')).toBeNull()
    })
  })

  it('keeps the user-selected tab across a null-initialTab rebroadcast', async () => {
    installMockBridge()
    const wrapper = mountView(makeSnapshot({ initialTab: 'storage' }))
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Updates')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    await wrapper.setProps({ snapshot: makeSnapshot({ initialTab: null }) as never })
    expect(wrapper.find('.gs-tab.active').text()).toBe('Updates')
  })

  it('re-applies the requested tab when a reopen pushes a new snapshot', async () => {
    installMockBridge()
    const wrapper = mountView(makeSnapshot({ initialTab: 'storage' }))
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'General')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    await wrapper.setProps({ snapshot: makeSnapshot({ initialTab: 'storage' }) as never })
    expect(wrapper.find('.gs-tab.active').text()).toBe('Folders')
  })

  it('GitHub link card click routes through the bridge', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    const link = wrapper.findComponent({ name: 'GitHubLinkCard' })
    expect(link.exists()).toBe(true)
    await link.trigger('click')
    expect(bridge.openExternalCalls).toEqual(['https://github.com/comfyanonymous/ComfyUI'])
  })

  const SHARED_IO = [
    { id: 'inputDir', label: 'Input Directory', value: '/shared/in', type: 'path' },
    { id: 'outputDir', label: 'Output Directory', value: '/shared/out', type: 'path' }
  ]

  async function openFolders(snapshot = makeSnapshot()) {
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Folders')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    return wrapper
  }

  function folderRows(wrapper: Awaited<ReturnType<typeof openFolders>>, kind: string) {
    return wrapper.findAll(`.shared-folder-row[data-kind="${kind}"]`)
  }

  it('Folders tab shows the Default Install Location first and browses it through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/installs'
    const wrapper = await openFolders()
    expect(wrapper.findAll('.gs-micro-title').map((el) => el.text())).toEqual([
      'Default Install Location',
      'Shared Folders',
      'Remove Comfy Desktop data'
    ])
    const row = wrapper.find('.storage-dir-row')
    expect(row.find('.storage-dir-name').text()).toBe('/home/u/ComfyUI-Installs')
    await row.find('.storage-dir-name').trigger('click')
    expect(bridge.openPathCalls).toEqual(['/home/u/ComfyUI-Installs'])
    await row.find('.storage-dir-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'installDir', value: '/picked/installs' }])
  })

  it('Advanced tab no longer shows the Default Install Location', async () => {
    installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Advanced')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(wrapper.text()).not.toContain('Install Location')
  })

  it('Folders tab lists models, input and output in one Shared Folders list', async () => {
    installMockBridge()
    const wrapper = await openFolders(makeSnapshot({ sharedDirectoriesFields: SHARED_IO }))
    const rows = wrapper.findAll('.shared-folder-row')
    expect(rows.map((r) => r.find('.shared-folder-path').text())).toEqual([
      '/home/u/ComfyUI/models',
      '/mnt/extra/models',
      '/shared/in',
      '/shared/out'
    ])
    expect(rows.map((r) => r.find('.shared-folder-kind').text())).toEqual([
      'Models',
      'Models',
      'Input',
      'Output'
    ])
    expect(rows.every((r) => r.find('.storage-item-icon.is-shared').exists())).toBe(true)
    expect(wrapper.find('.gs-storage-hint').text()).toContain('shared by every build')
  })

  it('Folders tab shows which models folder gets downloads without opening a menu', async () => {
    installMockBridge()
    const wrapper = await openFolders(makeSnapshot({ sharedDirectoriesFields: SHARED_IO }))
    const [primary, extra] = folderRows(wrapper, 'models')
    expect(primary!.find('.shared-folder-downloads-tag').text()).toContain('Downloads')
    expect(primary!.find('.shared-folder-use-downloads').exists()).toBe(false)
    expect(extra!.find('.shared-folder-use-downloads').text()).toBe('Use for downloads')
    for (const row of [...folderRows(wrapper, 'input'), ...folderRows(wrapper, 'output')]) {
      expect(row.find('.shared-folder-downloads').text()).toBe('')
    }
  })

  it('Folders tab moves downloads to another models folder with one click', async () => {
    const bridge = installMockBridge()
    const wrapper = await openFolders()
    await folderRows(wrapper, 'models')[1]!.find('.shared-folder-use-downloads').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([['/mnt/extra/models', '/home/u/ComfyUI/models']])
  })

  it('Folders tab keeps Remove as the only item in a models folder menu', async () => {
    installMockBridge()
    const wrapper = await openFolders()
    const [primary, extra] = folderRows(wrapper, 'models')
    expect(primary!.find('.shared-folder-more').exists()).toBe(false)
    await extra!.find('.shared-folder-more').trigger('click')
    await nextTick()
    await flushPromises()
    expect(menuItems().map((item) => item.text())).toEqual(['Remove'])
  })

  it('Folders tab browses and re-points a models folder through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/new/models'
    const wrapper = await openFolders()
    await folderRows(wrapper, 'models')[0]!.find('.shared-folder-action').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([['/mnt/new/models', '/mnt/extra/models']])
  })

  it('Folders tab ignores re-pointing a models folder at another listed folder', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/extra/models'
    const wrapper = await openFolders()
    await folderRows(wrapper, 'models')[0]!.find('.shared-folder-action').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Folders tab labels the add button "Add models folder"', async () => {
    installMockBridge()
    const wrapper = await openFolders()
    expect(wrapper.find('.shared-folders-add').text()).toBe('Add models folder')
  })

  it('Folders tab adds a shared models folder through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/new/models'
    const wrapper = await openFolders()
    await wrapper.find('.shared-folders-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([
      ['/home/u/ComfyUI/models', '/mnt/extra/models', '/new/models']
    ])
  })

  it('Folders tab does not add a models folder when browsing is cancelled', async () => {
    const bridge = installMockBridge()
    const wrapper = await openFolders()
    await wrapper.find('.shared-folders-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Folders tab ignores adding a folder that is already listed', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/extra/models'
    const wrapper = await openFolders()
    await wrapper.find('.shared-folders-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Folders tab ignores adding a listed folder with different separators or trailing slash', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/extra/models/'
    const wrapper = await openFolders()
    await wrapper.find('.shared-folders-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Folders tab removes a models folder after confirmation', async () => {
    const bridge = installMockBridge()
    const wrapper = await openFolders()
    await folderRows(wrapper, 'models')[1]!.find('.shared-folder-more').trigger('click')
    await nextTick()
    await menuItems()[0]!.trigger('click')
    await flushPromises()
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    modal.close(true)
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([['/home/u/ComfyUI/models']])
  })

  it('Folders tab keeps a models folder when removal is declined', async () => {
    const bridge = installMockBridge()
    const wrapper = await openFolders()
    await folderRows(wrapper, 'models')[1]!.find('.shared-folder-more').trigger('click')
    await nextTick()
    await menuItems()[0]!.trigger('click')
    await flushPromises()
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    modal.close(false)
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Folders tab browses the shared input folder through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/in'
    const wrapper = await openFolders(makeSnapshot({ sharedDirectoriesFields: SHARED_IO }))
    await folderRows(wrapper, 'input')[0]!.find('.shared-folder-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'inputDir', value: '/picked/in' }])
  })

  it('Folders tab browses the shared output folder through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/out'
    const wrapper = await openFolders(makeSnapshot({ sharedDirectoriesFields: SHARED_IO }))
    await folderRows(wrapper, 'output')[0]!.find('.shared-folder-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'outputDir', value: '/picked/out' }])
  })

  it('Folders tab opens a shared folder in the OS file manager when clicked', async () => {
    const bridge = installMockBridge()
    const wrapper = await openFolders(makeSnapshot({ sharedDirectoriesFields: SHARED_IO }))
    await folderRows(wrapper, 'output')[0]!.find('.shared-folder-path').trigger('click')
    expect(bridge.openPathCalls).toEqual(['/shared/out'])
  })

  it('Folders tab tooltip says how downloads and per-build choices work', async () => {
    installMockBridge()
    const wrapper = await openFolders(makeSnapshot({ sharedDirectoriesFields: SHARED_IO }))
    const tooltips = wrapper
      .findAll('.gs-micro-title .info-tooltip-trigger')
      .map((el) => el.attributes('aria-label') ?? '')
    expect(tooltips.some((text) => text.includes('Use for downloads'))).toBe(true)
    expect(tooltips.some((text) => text.includes('in its own Folders tab'))).toBe(true)
  })

  function snapshotOn(platform: string) {
    const base = makeSnapshot()
    return makeSnapshot({ appUpdate: { ...base.appUpdate, platform } })
  }

  async function openRemoveAppData(platform: string) {
    const bridge = installMockBridge()
    const wrapper = await openFolders(snapshotOn(platform))
    await wrapper.find('.gs-remove-app-data-btn').trigger('click')
    await flushPromises()
    return { bridge, wrapper, modal: useModal() }
  }

  it.each(['darwin', 'linux'])('Folders tab offers Remove Comfy Desktop data on %s', async (p) => {
    installMockBridge()
    const wrapper = await openFolders(snapshotOn(p))
    expect(wrapper.find('.gs-remove-app-data-btn').exists()).toBe(true)
  })

  it('Folders tab hides Remove Comfy Desktop data on Windows', async () => {
    installMockBridge()
    const wrapper = await openFolders(snapshotOn('win32'))
    expect(wrapper.find('.gs-remove-app-data-btn').exists()).toBe(false)
    expect(wrapper.findAll('.gs-micro-title').map((el) => el.text())).toEqual([
      'Default Install Location',
      'Shared Folders'
    ])
  })

  it('Remove Comfy Desktop data asks first, with all three boxes unchecked', async () => {
    const { modal } = await openRemoveAppData('darwin')
    expect(modal.state.visible).toBe(true)
    expect(modal.state.title).toBe('Remove Comfy Desktop data?')
    expect(modal.state.confirmStyle).toBe('danger')
    expect(modal.state.checkboxes).toEqual([
      { id: 'deleteInstances', label: 'Delete all ComfyUI instances', checked: false },
      { id: 'deleteModels', label: 'Delete all model files', checked: false },
      { id: 'deleteInputOutput', label: 'Delete shared input and output files', checked: false }
    ])
    const details = modal.state.messageDetails.flatMap((group) => group.items).join('\n')
    expect(details).toContain('Trash')
    expect(details).toContain(
      'Input and output folders you picked yourself, outside the instances you delete'
    )
    modal.close(false)
    await flushPromises()
  })

  it('Remove Comfy Desktop data tells Linux users how to delete the app', async () => {
    const { modal } = await openRemoveAppData('linux')
    const details = modal.state.messageDetails.flatMap((group) => group.items).join('\n')
    expect(details).toContain('AppImage')
    expect(details).toContain('apt remove')
    expect(details).not.toContain('Trash')
    modal.close(false)
    await flushPromises()
  })

  it('Remove Comfy Desktop data sends the checked boxes through the bridge', async () => {
    const { bridge, modal } = await openRemoveAppData('linux')
    modal.setCheckboxValue('deleteModels', true)
    modal.close(true)
    await flushPromises()
    expect(bridge.removeAppDataCalls).toEqual([
      { deleteInstances: false, deleteModels: true, deleteInputOutput: false }
    ])
  })

  it('Remove Comfy Desktop data sends the input and output box through the bridge', async () => {
    const { bridge, modal } = await openRemoveAppData('darwin')
    modal.setCheckboxValue('deleteInputOutput', true)
    modal.close(true)
    await flushPromises()
    expect(bridge.removeAppDataCalls).toEqual([
      { deleteInstances: false, deleteModels: false, deleteInputOutput: true }
    ])
  })

  it('Remove Comfy Desktop data keeps everything when unchecked', async () => {
    const { bridge, modal } = await openRemoveAppData('darwin')
    modal.close(true)
    await flushPromises()
    expect(bridge.removeAppDataCalls).toEqual([
      { deleteInstances: false, deleteModels: false, deleteInputOutput: false }
    ])
  })

  it('Remove Comfy Desktop data does nothing when cancelled', async () => {
    const { bridge, modal } = await openRemoveAppData('darwin')
    modal.setCheckboxValue('deleteInstances', true)
    modal.close(false)
    await flushPromises()
    expect(bridge.removeAppDataCalls).toEqual([])
  })

  it('Advanced tab renders the cache dir as a readonly path row that browses + opens', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/cache'
    const snapshot = makeSnapshot({
      cacheFields: [
        {
          id: 'cacheDir',
          label: 'Cache Directory',
          value: '/home/u/cache',
          type: 'path',
          openable: true
        }
      ]
    })
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Advanced')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    const row = wrapper.find('.storage-dir-row')
    expect(row.exists()).toBe(true)
    expect(row.find('.storage-dir-name').text()).toBe('/home/u/cache')
    await row.find('.storage-dir-name').trigger('click')
    expect(bridge.openPathCalls).toEqual(['/home/u/cache'])
    await row.find('.storage-dir-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'cacheDir', value: '/picked/cache' }])
  })

  it('renders diagnostics only in the Logs tab', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((tab) => tab.text() === 'Advanced')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(wrapper.text()).not.toContain('Diagnostics')

    await wrapper
      .findAll('.gs-tab')
      .find((tab) => tab.text() === 'Logs')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(wrapper.text()).toContain('Diagnostics')
    expect(wrapper.find('.gs-logs-btn').text()).toContain('Open logs folder')
    await wrapper.find('.gs-logs-btn').trigger('click')
    expect(bridge.openLogsFolderCalls).toBe(1)
  })

  it('close button routes to bridge.close', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper.find('.gs-close').trigger('click')
    expect(bridge.closeCalls).toBe(1)
  })

  it('Updates tab routes Check for updates click through the bridge', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Updates')!
      .trigger('keydown', { key: 'Enter' })
    await nextTick()
    const buttons = wrapper.findAll('button')
    const checkBtn = buttons.find((b) => /check/i.test(b.text()))
    expect(checkBtn, 'expected a "Check" CTA on idle state').toBeDefined()
    await checkBtn!.trigger('click')
    await flushPromises()
    expect(bridge.checkForUpdateCalls).toBeGreaterThanOrEqual(1)
  })

  describe('beta features opt-in row', () => {
    const BETA_LABEL = 'Opt-in to beta features'
    const TELEMETRY_LABEL = 'Send anonymous telemetry'

    function toggleFor(wrapper: ReturnType<typeof mountView>, label: string) {
      return wrapper.find(`button[role="switch"][aria-label="${label}"]`)
    }

    function snapshotWith(granted: boolean, beta: boolean) {
      const snap = makeSnapshot({ telemetryGranted: granted })
      const fields = snap.telemetryFields as Record<string, unknown>[]
      fields.find((f) => f['id'] === 'betaFeaturesEnabled')!['value'] = beta
      return snap
    }

    it('renders the seeded value from the snapshot and persists a change through the bridge', async () => {
      const bridge = installMockBridge()
      const wrapper = mountView(snapshotWith(true, true))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.exists()).toBe(true)
      expect(toggle.attributes('aria-checked')).toBe('true')

      await toggle.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toEqual([{ id: 'betaFeaturesEnabled', value: false }])
    })

    it('blocks the off -> on transition and explains why when telemetry consent is absent', async () => {
      const bridge = installMockBridge()
      const wrapper = mountView(snapshotWith(false, false))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.attributes('aria-disabled')).toBe('true')
      expect(toggle.attributes('title')).toBe(
        'Beta features require confirming data sharing in Settings, even if telemetry is currently on.'
      )

      await toggle.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toEqual([])
    })

    it('leaves the telemetry row itself untouched when consent is absent', () => {
      installMockBridge()
      const wrapper = mountView(snapshotWith(false, false))
      const toggle = toggleFor(wrapper, TELEMETRY_LABEL)
      expect(toggle.attributes('disabled')).toBeUndefined()
      expect(toggle.attributes('title')).toBeUndefined()
    })

    it('still allows leaving the beta programme while telemetry consent is absent, then blocks re-entry', async () => {
      const bridge = installMockBridge()
      const wrapper = mountView(snapshotWith(false, true))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.attributes('disabled')).toBeUndefined()

      await toggle.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toEqual([{ id: 'betaFeaturesEnabled', value: false }])

      await wrapper.setProps({ snapshot: snapshotWith(false, false) as never })
      const after = toggleFor(wrapper, BETA_LABEL)
      expect(after.attributes('aria-disabled')).toBe('true')
      await after.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toHaveLength(1)
    })

    it('enables both directions once telemetry consent is granted', () => {
      installMockBridge()
      const wrapper = mountView(snapshotWith(true, false))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.attributes('disabled')).toBeUndefined()
      expect(toggle.attributes('title')).toBeUndefined()
    })
  })
})
