import { describe, expect, it, beforeEach, vi } from 'vitest'
import { DOMWrapper, mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

import { useModal } from '../../composables/useModal'
import StoragePane, { type StorageSnapshot } from './StoragePane.vue'

interface ApiState {
  openPathCalls: string[]
  revealPathCalls: string[]
  openGlobalSettingsCalls: Array<string | undefined>
  browseFolderReturn: string | null
}

function installMockApi(opts: { platform?: string } = {}): ApiState {
  const state: ApiState = {
    openPathCalls: [],
    revealPathCalls: [],
    openGlobalSettingsCalls: [],
    browseFolderReturn: null
  }
  const api = {
    platform: opts.platform,
    browseFolder: async () => state.browseFolderReturn,
    openPath: async (path: string) => {
      state.openPathCalls.push(path)
    },
    revealPath: (path: string) => {
      state.revealPathCalls.push(path)
    },
    openGlobalSettings: (tab?: string) => {
      state.openGlobalSettingsCalls.push(tab)
    }
  }
  ;(window as unknown as { api: typeof api }).api = api
  return state
}

function makeSnapshot(): StorageSnapshot {
  return {
    sharedDirectoriesFields: [],
    modelsDirs: [
      { path: '/home/u/ComfyUI/models', isPrimary: true },
      { path: '/mnt/extra/models', isPrimary: false }
    ],
    modelsSystemDefault: '/home/u/ComfyUI/models'
  }
}

function mountPane(snapshot: StorageSnapshot = makeSnapshot()) {
  return mount(StoragePane, {
    props: {
      snapshot,
      sections: [],
      pendingRestartFieldIds: new Set<string>()
    },
    attachTo: document.body
  })
}

function makeStorageSections(
  modelDirs: string[],
  opts: { sharedOn?: boolean; primary?: string | null; own?: string } = {}
) {
  return [
    {
      fields: [
        {
          id: 'useSharedModels',
          label: 'Use Shared Models',
          value: opts.sharedOn ?? false,
          editable: true,
          editType: 'boolean'
        },
        {
          id: 'modelDirs',
          label: 'Model Directories',
          value: modelDirs,
          editable: true,
          editType: 'model-dirs'
        },
        {
          id: 'modelDirsPrimary',
          label: 'modelDirsPrimary',
          value: opts.primary ?? null,
          editable: true,
          editType: 'hidden'
        },
        {
          id: 'installModelsDir',
          label: 'installModelsDir',
          value: opts.own ?? '/own/models',
          editable: false,
          editType: 'hidden'
        }
      ]
    }
  ]
}

function makeIoSections(
  opts: {
    inputDir?: string
    outputDir?: string
    sharedInput?: boolean
    sharedOutput?: boolean
  } = {}
) {
  return [
    {
      fields: [
        {
          id: 'useSharedInput',
          label: 'Use Shared Input Folder',
          value: opts.sharedInput ?? false,
          editable: true,
          editType: 'boolean'
        },
        {
          id: 'useSharedOutput',
          label: 'Use Shared Output Folder',
          value: opts.sharedOutput ?? false,
          editable: true,
          editType: 'boolean'
        },
        {
          id: 'inputDir',
          label: 'Input Folder',
          value: opts.inputDir ?? '',
          editable: true,
          editType: 'path'
        },
        {
          id: 'outputDir',
          label: 'Output Folder',
          value: opts.outputDir ?? '',
          editable: true,
          editType: 'path'
        },
        {
          id: 'inputDirDefault',
          label: 'Input Folder',
          value: '/own/input',
          editable: false,
          editType: 'hidden'
        },
        {
          id: 'outputDirDefault',
          label: 'Output Folder',
          value: '/own/output',
          editable: false,
          editType: 'hidden'
        }
      ]
    }
  ]
}

function mountPaneWithSections(
  sections: Array<{ fields: Array<Record<string, unknown>> }>,
  snapshot: StorageSnapshot = makeSnapshot()
) {
  return mount(StoragePane, {
    props: {
      snapshot,
      sections: sections as never,
      pendingRestartFieldIds: new Set<string>()
    },
    attachTo: document.body
  })
}

function menuItems() {
  return [...document.querySelectorAll<HTMLElement>('.models-dir-menu [role="menuitem"]')].map(
    (el) => new DOMWrapper(el)
  )
}

describe('StoragePane', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the shared dirs from the snapshot prop as read-only rows', async () => {
    installMockApi()
    const wrapper = mountPane()
    await nextTick()
    const rows = wrapper.findAll('.models-dir-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    expect(rows[1]!.find('.tag-primary').exists()).toBe(false)
    expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
    expect(rows[0]!.find('.models-dir-action').exists()).toBe(false)
    expect(rows[1]!.find('.models-dir-action:not([aria-expanded])').exists()).toBe(false)
  })

  it('does not render the global Install Location section', async () => {
    installMockApi()
    const wrapper = mountPane()
    await nextTick()
    expect(wrapper.text()).not.toContain('Install Location')
  })

  it('promotes a shared dir by persisting modelDirsPrimary, not by reordering the global list', async () => {
    const api = installMockApi()
    const wrapper = mountPaneWithSections(makeStorageSections([], { sharedOn: true }))
    await nextTick()
    const toggles = wrapper.findAll('.models-dir-menu-wrap > button')
    expect(toggles).toHaveLength(2)
    await toggles[0]!.trigger('click')
    await nextTick()
    await flushPromises()
    const makePrimary = menuItems()[0]!
    await makePrimary.trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('update-field')
    expect(emitted).toBeTruthy()
    const [field, value] = emitted![0] as [{ id: string }, unknown]
    expect(field.id).toBe('modelDirsPrimary')
    expect(value).toBe('/mnt/extra/models')
  })

  it('closes the dir menu on Escape and restores focus to the toggle', async () => {
    installMockApi()
    const wrapper = mountPane()
    await nextTick()
    const toggle = wrapper.find<HTMLButtonElement>('.models-dir-menu-wrap > button')
    await toggle.trigger('click')
    await nextTick()
    await flushPromises()
    expect(document.querySelector('.models-dir-menu')).not.toBeNull()
    document
      .querySelector('.models-dir-menu')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('.models-dir-menu')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(toggle.element))
  })

  it('routes to global settings via the manage-shared link', async () => {
    const api = installMockApi()
    const wrapper = mountPane()
    await nextTick()
    const link = wrapper.find('.storage-manage-link')
    expect(link.exists()).toBe(true)
    await link.trigger('click')
    expect(api.openGlobalSettingsCalls).toEqual(['storage'])
  })

  it('puts the manage-shared link in the Models panel footer next to Add Directory', async () => {
    installMockApi()
    const wrapper = mountPane()
    await nextTick()
    const foot = wrapper.find('.models-dir-list .models-dir-foot')
    expect(foot.find('.models-dir-add').exists()).toBe(true)
    expect(foot.find('.storage-manage-link').text()).toBe(
      'Manage Shared Directories in Desktop Settings'
    )
  })

  it('tags shared model dirs as Shared and leaves build-only dirs untagged', async () => {
    installMockApi()
    const wrapper = mountPaneWithSections(makeStorageSections(['/b/models'], { sharedOn: true }))
    await nextTick()
    const rows = wrapper.findAll('.models-dir-row')
    const sharedRows = rows.filter((r) => r.find('.storage-item-icon.is-shared').exists())
    const ownRows = rows.filter((r) => !r.find('.storage-item-icon.is-shared').exists())
    expect(sharedRows.length).toBeGreaterThan(0)
    expect(ownRows.length).toBeGreaterThan(0)
    expect(sharedRows.every((r) => r.find('.tag-shared').text() === 'Shared')).toBe(true)
    expect(ownRows.every((r) => !r.find('.tag-shared').exists())).toBe(true)
  })

  it('hides the manage-shared link while shared models is off', async () => {
    installMockApi()
    const wrapper = mountPaneWithSections(makeStorageSections([]))
    await nextTick()
    expect(wrapper.find('.storage-manage-link').exists()).toBe(false)
  })

  it('renders no storage note when nothing is pending', async () => {
    installMockApi()
    const wrapper = mountPane()
    await nextTick()
    expect(wrapper.find('.storage-note').exists()).toBe(false)
  })

  it('flips the storage note to the warning state for pending per-install storage fields', async () => {
    installMockApi()
    const wrapper = mount(StoragePane, {
      props: {
        snapshot: makeSnapshot(),
        sections: [],
        pendingRestartFieldIds: new Set<string>(['useSharedInput'])
      },
      attachTo: document.body
    })
    await nextTick()
    expect(wrapper.find('.storage-note.is-warning').exists()).toBe(true)
  })

  describe('per-instance model directories (shared models off)', () => {
    it('renders the locked install-own row first (primary) plus extras', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(3)
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      expect(rows[1]!.find('.tag-primary').exists()).toBe(false)
      expect(rows[0]!.find('.models-dir-action').exists()).toBe(false)
      expect(rows[0]!.find('.models-dir-menu-wrap').exists()).toBe(false)
      expect(rows[0]!.find('.tag-local').exists()).toBe(true)
    })

    it('promotes an external dir by persisting modelDirsPrimary (no reordering)', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      await wrapper.find('.models-dir-menu-wrap > button').trigger('click')
      await nextTick()
      await flushPromises()
      await menuItems()[0]!.trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')
      expect(emitted).toBeTruthy()
      const [field, value] = emitted![0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/a/models')
    })

    it('matches a promoted primary despite trailing or duplicated separators', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/b/models'], { primary: '/a//models/' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/a/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('recognizes an install-own primary stored with a trailing separator', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models'], { sharedOn: true, primary: '/own/models/' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('matches a promoted primary containing . and .. segments', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/b/models'], { primary: '/a/x/.././/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/a/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('matches Windows path forms differing in case, separators, and dot segments', async () => {
      installMockApi({ platform: 'win32' })
      const wrapper = mountPaneWithSections(
        makeStorageSections(['C:\\Data\\Models'], {
          primary: 'c:/data/x/..//MODELS/',
          own: 'C:\\Own\\Models'
        })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('C:\\Data\\Models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('matches UNC path forms differing in separator noise', async () => {
      installMockApi({ platform: 'win32' })
      const wrapper = mountPaneWithSections(
        makeStorageSections(['\\\\server\\share\\models'], {
          primary: '\\\\server\\share\\Models\\',
          own: 'C:\\Own\\Models'
        })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('\\\\server\\share\\models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('clamps .. at the UNC share root, matching path.win32.resolve', async () => {
      installMockApi({ platform: 'win32' })
      const wrapper = mountPaneWithSections(
        makeStorageSections(['\\\\server\\share'], {
          primary: '\\\\server\\share\\models\\..',
          own: 'C:\\Own\\Models'
        })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('\\\\server\\share')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('does not equate a drive-relative path with a drive-absolute one', async () => {
      installMockApi({ platform: 'win32' })
      const wrapper = mountPaneWithSections(
        makeStorageSections(['C:\\Data\\Models'], {
          primary: 'c:data\\models',
          own: 'C:\\Own\\Models'
        })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      const dataRow = rows.find((r) => r.find('.models-dir-name').text() === 'C:\\Data\\Models')!
      expect(dataRow.find('.tag-primary').exists()).toBe(false)
    })

    it('renders the install-own dir once when it also appears in modelDirs', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/own/models', '/a/models']))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(2)
      const names = rows.map((r) => r.find('.models-dir-name').text())
      expect(names.filter((n) => n === '/own/models')).toHaveLength(1)
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-local').exists()).toBe(true)
    })

    it('renders the install-own dir once when a shared dir points at it', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections([], { sharedOn: true, own: '/home/u/ComfyUI/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      const names = rows.map((r) => r.find('.models-dir-name').text())
      expect(names.filter((n) => n === '/home/u/ComfyUI/models')).toHaveLength(1)
      expect(names).toContain('/mnt/extra/models')
    })

    it('puts the promoted external dir (primary) on top and sinks install-own to the bottom', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/b/models'], { primary: '/a/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/a/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      expect(rows[2]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[2]!.find('.tag-primary').exists()).toBe(false)
    })

    it('demotes back to install-own by persisting the install-own path', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models'], { primary: '/a/models' })
      )
      await nextTick()
      await wrapper.find('.models-dir-menu-wrap > button').trigger('click')
      await nextTick()
      await flushPromises()
      await menuItems()[0]!.trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/own/models')
    })

    it('locked install-own row offers no Remove action even when not primary', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models'], { primary: '/a/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      const ownRow = rows[rows.length - 1]!
      expect(ownRow.find('.models-dir-name').text()).toBe('/own/models')
      await ownRow.find('.models-dir-menu-wrap > button').trigger('click')
      await nextTick()
      await flushPromises()
      const items = menuItems()
      expect(items).toHaveLength(1)
      expect(items[0]!.text()).toContain('Use for Model Downloads')
    })

    it('labels the add button "Add Directory", not the shared-directory wording', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models']))
      await nextTick()
      expect(wrapper.find('.models-dir-add').text()).toBe('Add Directory')
    })

    it('emits update-field with the appended dir when adding', async () => {
      const api = installMockApi()
      api.browseFolderReturn = '/c/models'
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      await wrapper.find('.models-dir-add').trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')
      expect(emitted).toBeTruthy()
      const [field, value] = emitted![0] as [{ id: string }, string[]]
      expect(field.id).toBe('modelDirs')
      expect(value).toEqual(['/a/models', '/b/models', '/c/models'])
    })

    it('opens the folder when a model path is clicked', async () => {
      const api = installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models']))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      await rows[1]!.find('.models-dir-name').trigger('click')
      expect(api.openPathCalls).toEqual(['/a/models'])
    })

    it('shows one unified list when shared models is on: shared dirs, instance extras, install-own last', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models'], { sharedOn: true }))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(4)
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      const extraRow = rows[2]!
      expect(extraRow.find('.models-dir-name').text()).toBe('/a/models')
      expect(extraRow.find('.models-dir-action[aria-label^="Browse"]').exists()).toBe(true)
      const ownRow = rows[3]!
      expect(ownRow.find('.models-dir-name').text()).toBe('/own/models')
      expect(ownRow.find('.tag-primary').exists()).toBe(false)
      expect(ownRow.find('.models-dir-action[aria-label^="Browse"]').exists()).toBe(false)
      expect(ownRow.find('.models-dir-menu-wrap').exists()).toBe(true)
      expect(wrapper.text()).toContain('Include Shared Directories')
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
      expect(extraRow.find('.storage-item-icon.is-shared').exists()).toBe(false)
      expect(ownRow.find('.storage-item-icon.is-shared').exists()).toBe(false)
    })

    it('collapses a per-instance duplicate of an included shared dir into one row', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/home/u/ComfyUI/models', '/c/models'], { sharedOn: true })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(4)
      const paths = rows.map((r) => r.find('.models-dir-name').text())
      expect(paths.filter((p) => p === '/home/u/ComfyUI/models')).toHaveLength(1)
      expect(paths).toContain('/c/models')
    })

    it('ignores adding a dir that is already in the effective set', async () => {
      const api = installMockApi()
      api.browseFolderReturn = '/own/models'
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models']))
      await nextTick()
      await wrapper.find('.models-dir-add').trigger('click')
      await flushPromises()
      expect(wrapper.emitted('update-field')).toBeUndefined()
    })

    it('removes a per-instance extra after confirmation', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      await wrapper.findAll('.models-dir-menu-wrap > button')[0]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = menuItems()
      const removeItem = items.find((i) => i.text().includes('Remove'))!
      await removeItem.trigger('click')
      await flushPromises()
      const modal = useModal()
      expect(modal.state.visible).toBe(true)
      modal.close(true)
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[emitted.length - 1] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirs')
      expect(value).toEqual(['/b/models'])
    })

    it('collapses repeated stored paths into one row and removes all matches at once', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/a/models', '/b/models'])
      )
      await nextTick()
      const names = wrapper.findAll('.models-dir-name').map((n) => n.text())
      expect(names).toEqual(['/own/models', '/a/models', '/b/models'])
      await wrapper.findAll('.models-dir-menu-wrap > button')[0]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = menuItems()
      await items.find((i) => i.text().includes('Remove'))!.trigger('click')
      await flushPromises()
      const modal = useModal()
      expect(modal.state.visible).toBe(true)
      modal.close(true)
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[emitted.length - 1] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirs')
      expect(value).toEqual(['/b/models'])
    })

    it('keeps the dirs when the remove confirmation is declined', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      await wrapper.findAll('.models-dir-menu-wrap > button')[0]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = menuItems()
      await items.find((i) => i.text().includes('Remove'))!.trigger('click')
      await flushPromises()
      const modal = useModal()
      expect(modal.state.visible).toBe(true)
      modal.close(false)
      await flushPromises()
      expect(wrapper.emitted('update-field')).toBeUndefined()
    })

    it('shows no shared badge on per-instance dirs when shared models is off', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows.every((r) => !r.find('.storage-item-icon.is-shared').exists())).toBe(true)
    })

    it('promoting an instance extra while shared models is on persists modelDirsPrimary', async () => {
      const api = installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections(['/x'], { sharedOn: true }))
      await nextTick()
      const toggles = wrapper.findAll('.models-dir-menu-wrap > button')
      expect(toggles).toHaveLength(3)
      await toggles[1]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = menuItems()
      await items.find((i) => i.text().includes('Use for Model Downloads'))!.trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/x')
    })

    it('promotes the locked install-own row to download target while shared models is on', async () => {
      const api = installMockApi()
      const wrapper = mountPaneWithSections(makeStorageSections([], { sharedOn: true }))
      await nextTick()
      const toggles = wrapper.findAll('.models-dir-menu-wrap > button')
      expect(toggles).toHaveLength(2)
      await toggles[1]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = menuItems()
      await items.find((i) => i.text().includes('Use for Model Downloads'))!.trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/own/models')
    })

    it('shows the Downloads tag on the install-own row when its path is the persisted primary', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeStorageSections([], { sharedOn: true, primary: '/own/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      expect(rows.slice(1).every((r) => !r.find('.tag-primary').exists())).toBe(true)
    })
  })

  describe('per-instance input/output (shared I/O off)', () => {
    it('shows the computed defaults with a "default" tag when unset', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeIoSections())
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/own/input')
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/own/output')
      expect(rows[0]!.find('.storage-dir-tag').exists()).toBe(true)
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(false)
    })

    it('shows the stored override (no default tag) when set', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(makeIoSections({ inputDir: '/ext/in' }))
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/ext/in')
      expect(rows[0]!.find('.storage-dir-tag').exists()).toBe(false)
    })

    it('persists empty when the browsed dir equals the computed default (clone-safe)', async () => {
      const api = installMockApi()
      api.browseFolderReturn = '/own/input'
      const wrapper = mountPaneWithSections(makeIoSections())
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-action').trigger('click')
      await flushPromises()
      const [field, value] = wrapper.emitted('update-field')![0] as [{ id: string }, unknown]
      expect(field.id).toBe('inputDir')
      expect(value).toBe('')
    })

    it('persists the override when the browsed dir differs from the default', async () => {
      const api = installMockApi()
      api.browseFolderReturn = '/ext/in'
      const wrapper = mountPaneWithSections(makeIoSections())
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-action').trigger('click')
      await flushPromises()
      const [field, value] = wrapper.emitted('update-field')![0] as [{ id: string }, unknown]
      expect(field.id).toBe('inputDir')
      expect(value).toBe('/ext/in')
    })

    it('opens the effective input folder when its path is clicked', async () => {
      const api = installMockApi()
      const wrapper = mountPaneWithSections(makeIoSections({ inputDir: '/ext/in' }))
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-name').trigger('click')
      expect(api.openPathCalls).toEqual(['/ext/in'])
    })
  })

  describe('shared input/output (shared I/O on)', () => {
    function makeSharedIoSnapshot(): StorageSnapshot {
      return {
        ...makeSnapshot(),
        sharedDirectoriesFields: [
          { id: 'inputDir', label: 'Shared Input', value: '/shared/in', type: 'path' },
          { id: 'outputDir', label: 'Shared Output', value: '/shared/out', type: 'path' }
        ] as never
      }
    }

    it('renders both shared dirs as readonly path rows when both toggles are on', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: true }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/shared/in')
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/shared/out')
      expect(rows[0]!.find('.storage-dir-tag').exists()).toBe(false)
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
      expect(rows[1]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
    })

    it('mixes shared input with a per-instance output independently', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: false }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/shared/in')
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/own/output')
      expect(rows[1]!.find('.storage-item-icon.is-shared').exists()).toBe(false)
      expect(rows[1]!.find('.storage-dir-tag').exists()).toBe(true)
    })

    it('mixes a per-instance input with shared output independently', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: false, sharedOutput: true, inputDir: '/ext/in' }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/ext/in')
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(false)
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/shared/out')
      expect(rows[1]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
    })

    it('toggling input emits exactly useSharedInput; output emits exactly useSharedOutput', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: true }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const switches = wrapper.findAll('.storage-header-toggle .bt-switch')
      expect(switches).toHaveLength(2)
      await switches[0]!.trigger('click')
      await switches[1]!.trigger('click')
      const emitted = wrapper.emitted('update-field')!
      expect(emitted).toHaveLength(2)
      expect((emitted[0]![0] as { id: string }).id).toBe('useSharedInput')
      expect(emitted[0]![1]).toBe(false)
      expect((emitted[1]![0] as { id: string }).id).toBe('useSharedOutput')
      expect(emitted[1]![1]).toBe(false)
    })

    it('opens a shared dir when its path is clicked', async () => {
      const api = installMockApi()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: true }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-name').trigger('click')
      expect(api.openPathCalls).toEqual(['/shared/in'])
    })

    it('shared rows are read-only: no Browse, manage routes to Desktop Settings', async () => {
      const api = installMockApi()
      api.browseFolderReturn = '/picked/in'
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: true }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const row = wrapper.findAll('.storage-dir-row')[0]!
      expect(row.find('.storage-dir-action[aria-label^="Browse"]').exists()).toBe(false)
      await row
        .find('.storage-dir-action[aria-label^="Manage Shared Directories"]')
        .trigger('click')
      await flushPromises()
      expect(api.openGlobalSettingsCalls).toEqual(['storage'])
      expect(wrapper.emitted('update-field')).toBeUndefined()
    })

    it('tags shared input and output rows as Shared with a text Manage action', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: false }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const [sharedRow, ownRow] = wrapper.findAll('.storage-dir-row')
      expect(sharedRow!.find('.storage-dir-shared-tag').text()).toBe('Shared')
      expect(
        sharedRow!.find('.storage-dir-action[aria-label^="Manage Shared Directories"]').text()
      ).toBe('Manage')
      expect(ownRow!.find('.storage-dir-shared-tag').exists()).toBe(false)
      expect(ownRow!.find('.storage-dir-tag').text()).toBe('default')
    })

    it('browsing a per-instance output updates only the install outputDir field', async () => {
      const api = installMockApi()
      api.browseFolderReturn = '/ext/out'
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: false }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      await rows[1]!.find('.storage-dir-action').trigger('click')
      await flushPromises()
      const [field, value] = wrapper.emitted('update-field')![0] as [{ id: string }, unknown]
      expect(field.id).toBe('outputDir')
      expect(value).toBe('/ext/out')
    })

    it('defaults to the shared folders when the toggles are absent', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections([{ fields: [] }] as never, makeSharedIoSnapshot())
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/shared/in')
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/shared/out')
    })
  })

  describe('custom model paths (extra_model_paths.yaml)', () => {
    function makeExtraSection() {
      return {
        name: 'my_external',
        basePath: '/ext/base',
        basePathExists: true,
        isDefault: false,
        dirs: [
          {
            type: 'checkpoints',
            rawType: 'checkpoints',
            dir: '/ext/base/checkpoints',
            dirExists: true
          },
          {
            type: 'controlnet',
            rawType: 'controlnet',
            dir: '/ext/base/t2i_adapter',
            dirExists: false
          }
        ]
      }
    }

    function sectionsWithExtra(view: unknown) {
      return [
        {
          fields: [
            {
              id: 'useSharedModels',
              label: 'Use Shared Models',
              value: false,
              editable: true,
              editType: 'boolean'
            },
            {
              id: 'modelDirs',
              label: 'Model Directories',
              value: [],
              editable: true,
              editType: 'model-dirs'
            },
            {
              id: 'modelDirsPrimary',
              label: 'modelDirsPrimary',
              value: null,
              editable: true,
              editType: 'hidden'
            },
            {
              id: 'installModelsDir',
              label: 'installModelsDir',
              value: '/own/models',
              editable: false,
              editType: 'hidden'
            },
            {
              id: 'extraModelPaths',
              label: 'extraModelPaths',
              value: view,
              editable: false,
              editType: 'hidden'
            }
          ]
        }
      ]
    }

    function extraView() {
      return {
        yamlPath: '/own/extra_model_paths.yaml',
        exists: true,
        sections: [makeExtraSection()]
      }
    }

    function findExtraRow(wrapper: ReturnType<typeof mountPaneWithSections>) {
      return wrapper
        .findAll('.models-dir-row')
        .find((r) => r.text().includes('/own/extra_model_paths.yaml'))!
    }

    it('renders the yaml file as a single read-only row with the YAML pill', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      const extraRow = findExtraRow(wrapper)
      expect(extraRow).toBeTruthy()
      const pill = extraRow.find('.tag-local')
      expect(pill.exists()).toBe(true)
      expect(pill.text()).toContain('YAML')
      expect(extraRow.find('.tag-missing').exists()).toBe(false)
      expect(extraRow.find('.tag-primary').exists()).toBe(false)
      expect(extraRow.find('.storage-item-icon.is-shared').exists()).toBe(false)
    })

    it('opens the detail modal listing per-type dirs when the row is clicked', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      expect(document.body.textContent).toContain('/ext/base/checkpoints')
      expect(document.body.textContent).toContain('/ext/base/t2i_adapter')
    })

    it('collapses a multi-section yaml into one row, all sections in the modal', async () => {
      installMockApi()
      const view = {
        yamlPath: '/own/extra_model_paths.yaml',
        exists: true,
        sections: [
          makeExtraSection(),
          {
            name: 'nas',
            basePath: '/nas/models',
            basePathExists: true,
            isDefault: true,
            dirs: [{ type: 'loras', rawType: 'loras', dir: '/nas/models/loras', dirExists: true }]
          }
        ]
      }
      const wrapper = mountPaneWithSections(sectionsWithExtra(view))
      await nextTick()
      expect(
        wrapper
          .findAll('.models-dir-row')
          .filter((r) => r.text().includes('extra_model_paths.yaml'))
      ).toHaveLength(1)
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      expect(document.body.textContent).toContain('/ext/base/checkpoints')
      expect(document.body.textContent).toContain('/nas/models/loras')
      expect(document.querySelector('.empm-tag')).toBeTruthy()
    })

    it('reveals the yaml file in its folder from the modal footer', async () => {
      const api = installMockApi()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      const actions = Array.from(document.querySelectorAll('.empm-action')) as HTMLButtonElement[]
      const yamlBtn = actions.find((b) => b.textContent?.includes('.yaml'))!
      yamlBtn.click()
      expect(api.revealPathCalls).toContain('/own/extra_model_paths.yaml')
      expect(api.openPathCalls).not.toContain('/own/extra_model_paths.yaml')
    })

    it('opens a per-type dir from the modal when its path is clicked', async () => {
      const api = installMockApi()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      const dirBtns = Array.from(document.querySelectorAll('.empm-dir-path')) as HTMLButtonElement[]
      dirBtns.find((b) => b.textContent === '/ext/base/checkpoints')!.click()
      expect(api.openPathCalls).toContain('/ext/base/checkpoints')
    })

    it('marks a missing per-type dir red (is-missing) instead of a badge', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      const dirBtns = Array.from(document.querySelectorAll('.empm-dir-path')) as HTMLButtonElement[]
      const present = dirBtns.find((b) => b.textContent === '/ext/base/checkpoints')!
      const missing = dirBtns.find((b) => b.textContent === '/ext/base/t2i_adapter')!
      expect(present.classList.contains('is-missing')).toBe(false)
      expect(missing.classList.contains('is-missing')).toBe(true)
    })

    it('emits refresh when the modal refresh button is clicked', async () => {
      installMockApi()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      ;(document.querySelector('.empm-refresh') as HTMLButtonElement).click()
      expect(wrapper.emitted('refresh')).toHaveLength(1)
    })
  })
})
