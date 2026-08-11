import { describe, expect, it, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'

import { en } from '../../lib/i18nMessages.ts'
import { useModal } from '../../composables/useModal'
import StoragePane, { type StorageSnapshot } from './StoragePane.vue'

interface BridgeState {
  updateFieldCalls: Array<{ id: string; value: unknown }>
  setModelsDirsCalls: string[][]
  openPathCalls: string[]
  revealPathCalls: string[]
  openSettingsTabCalls: string[]
  browseFolderReturn: string | null
}

function installMockBridge(opts: { platform?: string } = {}): BridgeState {
  const state: BridgeState = {
    updateFieldCalls: [],
    setModelsDirsCalls: [],
    openPathCalls: [],
    revealPathCalls: [],
    openSettingsTabCalls: [],
    browseFolderReturn: null
  }
  const bridge = {
    platform: opts.platform,
    globalSettingsUpdateField: async (id: string, value: unknown) => {
      state.updateFieldCalls.push({ id, value })
      return { ok: true }
    },
    globalSettingsBrowseFolder: async () => state.browseFolderReturn,
    globalSettingsOpenPath: (path: string) => {
      state.openPathCalls.push(path)
    },
    globalSettingsRevealPath: (path: string) => {
      state.revealPathCalls.push(path)
    },
    globalSettingsSetModelsDirs: async (dirs: string[]) => {
      state.setModelsDirsCalls.push([...dirs])
      return { ok: true }
    },
    openSettingsTab: (tab: string) => {
      state.openSettingsTabCalls.push(tab)
    }
  }
  ;(window as unknown as { __comfyTitlePopup: typeof bridge }).__comfyTitlePopup = bridge
  return state
}

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
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
    global: { plugins: [makeI18n()] },
    attachTo: document.body
  })
}

// Per-install storage section with shared-models toggled off and a per-instance
// model-dirs list, exercising the StoragePane's own ModelsDirList wiring.
// `installModelsDir` is the locked install-own row; `modelDirsPrimary` selects
// which external dir (if any) is primary.
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

// Per-install section with independent shared input/output toggles (default
// off here) plus the per-install path fields and their computed defaults.
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
    global: { plugins: [makeI18n()] },
    attachTo: document.body
  })
}

describe('StoragePane', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the shared dirs from the snapshot prop as read-only rows', async () => {
    installMockBridge()
    const wrapper = mountPane()
    await nextTick()
    const rows = wrapper.findAll('.models-dir-row')
    expect(rows).toHaveLength(2)
    // With no persisted primary, the first shared dir is the effective primary.
    expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    expect(rows[1]!.find('.tag-primary').exists()).toBe(false)
    // Shared rows carry the shared badge and expose no browse action here.
    expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
    expect(rows[0]!.find('.models-dir-action').exists()).toBe(false)
    expect(rows[1]!.find('.models-dir-action:not([aria-expanded])').exists()).toBe(false)
  })

  // The global default install location is intentionally NOT shown in the
  // per-instance Storage tab — it only belongs in Global Desktop Settings.
  it('does not render the global Install Location section', async () => {
    installMockBridge()
    const wrapper = mountPane()
    await nextTick()
    expect(wrapper.text()).not.toContain('Install Location')
  })

  // Promoting a shared dir is a per-install choice now: it persists the
  // install's `modelDirsPrimary` and must never rewrite the global list.
  it('promotes a shared dir by persisting modelDirsPrimary, not by reordering the global list', async () => {
    const bridge = installMockBridge()
    const wrapper = mountPaneWithSections(makeStorageSections([], { sharedOn: true }))
    await nextTick()
    // Menus: the non-primary shared dir and the install-own row (promotable
    // even while shared dirs are included).
    const toggles = wrapper.findAll('.models-dir-menu-wrap > button')
    expect(toggles).toHaveLength(2)
    await toggles[0]!.trigger('click')
    await nextTick()
    await flushPromises()
    const makePrimary = wrapper.find('.models-dir-menu button[role="menuitem"]')
    await makePrimary.trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('update-field')
    expect(emitted).toBeTruthy()
    const [field, value] = emitted![0] as [{ id: string }, unknown]
    expect(field.id).toBe('modelDirsPrimary')
    expect(value).toBe('/mnt/extra/models')
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('closes the dir menu on Escape and restores focus to the toggle', async () => {
    installMockBridge()
    const wrapper = mountPane()
    await nextTick()
    const toggle = wrapper.find<HTMLButtonElement>('.models-dir-menu-wrap > button')
    await toggle.trigger('click')
    await nextTick()
    await flushPromises()
    expect(wrapper.find('.models-dir-menu').exists()).toBe(true)
    await wrapper.find('.models-dir-menu').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.models-dir-menu').exists()).toBe(false)
    expect(document.activeElement).toBe(toggle.element)
  })

  // Shared dirs are edited in Global Desktop Settings; the instance pane only
  // links there instead of offering browse/remove on shared rows.
  it('routes to global settings via the manage-shared link', async () => {
    const bridge = installMockBridge()
    const wrapper = mountPane()
    await nextTick()
    const link = wrapper.find('.storage-manage-link')
    expect(link.exists()).toBe(true)
    await link.trigger('click')
    expect(bridge.openSettingsTabCalls).toEqual(['global'])
  })

  it('hides the manage-shared link while shared models is off', async () => {
    installMockBridge()
    const wrapper = mountPaneWithSections(makeStorageSections([]))
    await nextTick()
    expect(wrapper.find('.storage-manage-link').exists()).toBe(false)
  })

  // Sharing scope is conveyed inline (shared badges, header toggles, manage
  // actions); the note area is reserved for the restart warning.
  it('renders no storage note when nothing is pending', async () => {
    installMockBridge()
    const wrapper = mountPane()
    await nextTick()
    expect(wrapper.find('.storage-note').exists()).toBe(false)
  })

  // Per-install storage edits show the restart warning via the parent-supplied
  // pending set (the parent records them on update-field).
  it('flips the storage note to the warning state for pending per-install storage fields', async () => {
    installMockBridge()
    const wrapper = mount(StoragePane, {
      props: {
        snapshot: makeSnapshot(),
        sections: [],
        pendingRestartFieldIds: new Set<string>(['useSharedInput'])
      },
      global: { plugins: [makeI18n()] },
      attachTo: document.body
    })
    await nextTick()
    expect(wrapper.find('.storage-note.is-warning').exists()).toBe(true)
  })

  describe('per-instance model directories (shared models off)', () => {
    it('renders the locked install-own row first (primary) plus extras', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      // install-own row + 2 extras = 3 rows. Row 0 is the install-own primary.
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(3)
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      expect(rows[1]!.find('.tag-primary').exists()).toBe(false)
      // The install-own row is locked: no browse button, no menu (undeletable),
      // and carries the "Instance only" pill.
      expect(rows[0]!.find('.models-dir-action').exists()).toBe(false)
      expect(rows[0]!.find('.models-dir-menu-wrap').exists()).toBe(false)
      expect(rows[0]!.find('.tag-local').exists()).toBe(true)
    })

    it('promotes an external dir by persisting modelDirsPrimary (no reordering)', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      // First menu belongs to the first extra (/a/models), since row 0 is locked.
      await wrapper.find('.models-dir-menu-wrap > button').trigger('click')
      await nextTick()
      await flushPromises()
      await wrapper.find('.models-dir-menu button[role="menuitem"]').trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')
      expect(emitted).toBeTruthy()
      const [field, value] = emitted![0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/a/models')
    })

    it('matches a promoted primary despite trailing or duplicated separators', async () => {
      installMockBridge()
      // Stored primary differs from the dir entry only in separator noise; the
      // backend's path.resolve treats them as equal, so the renderer must too.
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/b/models'], { primary: '/a//models/' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/a/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('recognizes an install-own primary stored with a trailing separator', async () => {
      installMockBridge()
      // sharedOn makes this discriminating: without canonicalization the raw
      // '/own/models/' matches nothing and the first shared dir becomes
      // primary instead of the own row.
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models'], { sharedOn: true, primary: '/own/models/' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      // Canonicalization maps '/own/models/' onto the install-own row: it stays
      // the primary on top instead of falling back to a shared/external dir.
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('matches a promoted primary containing . and .. segments', async () => {
      installMockBridge()
      // The backend's path.resolve collapses dot segments; the renderer's
      // lexical canonicalization must agree so the same dir shows as primary.
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/b/models'], { primary: '/a/x/.././/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/a/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
    })

    it('matches Windows path forms differing in case, separators, and dot segments', async () => {
      installMockBridge({ platform: 'win32' })
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
      installMockBridge({ platform: 'win32' })
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
      installMockBridge({ platform: 'win32' })
      // resolve('\\\\server\\share\\models\\..') clamps to the share root, so
      // it must match a row for '\\\\server\\share' - and never climb above it.
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
      installMockBridge({ platform: 'win32' })
      // 'c:data\\models' resolves against the C: drive's cwd (unknown to the
      // renderer), so it must NOT be treated as 'C:\\Data\\Models'.
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
      installMockBridge()
      // A stale record can persist the own dir as an extra; it must collapse
      // into the single locked own row (the backend excludes it the same way).
      const wrapper = mountPaneWithSections(makeStorageSections(['/own/models', '/a/models']))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(2)
      const names = rows.map((r) => r.find('.models-dir-name').text())
      expect(names.filter((n) => n === '/own/models')).toHaveLength(1)
      // Still the locked row, not a removable extra.
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-local').exists()).toBe(true)
    })

    it('renders the install-own dir once when a shared dir points at it', async () => {
      installMockBridge()
      // Default snapshot shares '/home/u/ComfyUI/models'; make that the
      // install's own dir with sharing on: it must render only as the locked
      // own row, not additionally as a read-only shared row.
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
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/b/models'], { primary: '/a/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      // Primary on top: /a/models leads; the locked install-own row is last.
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/a/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      expect(rows[2]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[2]!.find('.tag-primary').exists()).toBe(false)
    })

    it('demotes back to install-own by persisting the install-own path', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models'], { primary: '/a/models' })
      )
      await nextTick()
      // Install-own row (locked, not the download target) exposes only "Use for Model Downloads".
      await wrapper.find('.models-dir-menu-wrap > button').trigger('click')
      await nextTick()
      await flushPromises()
      await wrapper.find('.models-dir-menu button[role="menuitem"]').trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/own/models')
    })

    it('locked install-own row offers no Remove action even when not primary', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models'], { primary: '/a/models' })
      )
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      // The locked install-own row sits last (it's not primary); open its menu
      // and assert it offers only "Use for Model Downloads" (no Remove).
      const ownRow = rows[rows.length - 1]!
      expect(ownRow.find('.models-dir-name').text()).toBe('/own/models')
      await ownRow.find('.models-dir-menu-wrap > button').trigger('click')
      await nextTick()
      await flushPromises()
      const items = ownRow.findAll('.models-dir-menu button[role="menuitem"]')
      expect(items).toHaveLength(1)
      expect(items[0]!.text()).toContain('Use for Model Downloads')
    })

    it('emits update-field with the appended dir when adding', async () => {
      const bridge = installMockBridge()
      bridge.browseFolderReturn = '/c/models'
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
      const bridge = installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models']))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      await rows[1]!.find('.models-dir-name').trigger('click')
      expect(bridge.openPathCalls).toEqual(['/a/models'])
    })

    it('shows one unified list when shared models is on: shared dirs, instance extras, install-own last', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models'], { sharedOn: true }))
      await nextTick()
      // 2 shared dirs from the snapshot + the per-instance extra + install-own.
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(4)
      // The effective primary stays on the first shared dir.
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      // The per-instance extra keeps its editable affordances even while
      // shared dirs are included (the two sources are additive).
      const extraRow = rows[2]!
      expect(extraRow.find('.models-dir-name').text()).toBe('/a/models')
      expect(extraRow.find('.models-dir-action[aria-label^="Browse"]').exists()).toBe(true)
      // The install-own row is last, locked: no primary tag, no browse; it
      // still has a menu so it can be promoted to the download target.
      const ownRow = rows[3]!
      expect(ownRow.find('.models-dir-name').text()).toBe('/own/models')
      expect(ownRow.find('.tag-primary').exists()).toBe(false)
      expect(ownRow.find('.models-dir-action[aria-label^="Browse"]').exists()).toBe(false)
      expect(ownRow.find('.models-dir-menu-wrap').exists()).toBe(true)
      expect(wrapper.text()).toContain('Include Shared Directories')
      // Shared dirs carry the shared badge; the per-instance rows don't.
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
      expect(extraRow.find('.storage-item-icon.is-shared').exists()).toBe(false)
      expect(ownRow.find('.storage-item-icon.is-shared').exists()).toBe(false)
    })

    it('collapses a per-instance duplicate of an included shared dir into one row', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/home/u/ComfyUI/models', '/c/models'], { sharedOn: true })
      )
      await nextTick()
      // The duplicate of the first shared dir is hidden: shared 2 + /c/models + own.
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows).toHaveLength(4)
      const paths = rows.map((r) => r.find('.models-dir-name').text())
      expect(paths.filter((p) => p === '/home/u/ComfyUI/models')).toHaveLength(1)
      expect(paths).toContain('/c/models')
    })

    it('ignores adding a dir that is already in the effective set', async () => {
      const bridge = installMockBridge()
      bridge.browseFolderReturn = '/own/models'
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models']))
      await nextTick()
      await wrapper.find('.models-dir-add').trigger('click')
      await flushPromises()
      expect(wrapper.emitted('update-field')).toBeUndefined()
    })

    it('removes a per-instance extra after confirmation', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      // Rows: own (primary), /a/models, /b/models. Open /a/models' menu.
      await wrapper.findAll('.models-dir-menu-wrap > button')[0]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = wrapper.findAll('.models-dir-menu button[role="menuitem"]')
      const removeItem = items.find((i) => i.text().includes('Remove'))!
      await removeItem.trigger('click')
      await flushPromises()
      // Confirm the modal (module-level singleton state).
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
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeStorageSections(['/a/models', '/a/models', '/b/models'])
      )
      await nextTick()
      // The duplicate stored '/a/models' renders a single row: own (primary),
      // /a/models, /b/models.
      const names = wrapper.findAll('.models-dir-name').map((n) => n.text())
      expect(names).toEqual(['/own/models', '/a/models', '/b/models'])
      // Removing the deduped row drops every matching stored entry.
      await wrapper.findAll('.models-dir-menu-wrap > button')[0]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = wrapper.findAll('.models-dir-menu button[role="menuitem"]')
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
      installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      await wrapper.findAll('.models-dir-menu-wrap > button')[0]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = wrapper.findAll('.models-dir-menu button[role="menuitem"]')
      await items.find((i) => i.text().includes('Remove'))!.trigger('click')
      await flushPromises()
      const modal = useModal()
      expect(modal.state.visible).toBe(true)
      modal.close(false)
      await flushPromises()
      expect(wrapper.emitted('update-field')).toBeUndefined()
    })

    it('shows no shared badge on per-instance dirs when shared models is off', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/a/models', '/b/models']))
      await nextTick()
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows.every((r) => !r.find('.storage-item-icon.is-shared').exists())).toBe(true)
    })

    it('promoting an instance extra while shared models is on persists modelDirsPrimary', async () => {
      const bridge = installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections(['/x'], { sharedOn: true }))
      await nextTick()
      // Rows: shared primary (no menu), shared /mnt/extra/models, extra /x, own.
      const toggles = wrapper.findAll('.models-dir-menu-wrap > button')
      expect(toggles).toHaveLength(3)
      await toggles[1]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = wrapper.findAll('.models-dir-menu button[role="menuitem"]')
      await items.find((i) => i.text().includes('Use for Model Downloads'))!.trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/x')
      // The global list is never rewritten from the instance pane.
      expect(bridge.setModelsDirsCalls).toEqual([])
    })

    it('promotes the locked install-own row to download target while shared models is on', async () => {
      const bridge = installMockBridge()
      const wrapper = mountPaneWithSections(makeStorageSections([], { sharedOn: true }))
      await nextTick()
      // Rows: shared primary (no menu), shared /mnt/extra/models, own (last).
      const toggles = wrapper.findAll('.models-dir-menu-wrap > button')
      expect(toggles).toHaveLength(2)
      await toggles[1]!.trigger('click')
      await nextTick()
      await flushPromises()
      const items = wrapper.findAll('.models-dir-menu button[role="menuitem"]')
      await items.find((i) => i.text().includes('Use for Model Downloads'))!.trigger('click')
      await flushPromises()
      const emitted = wrapper.emitted('update-field')!
      const [field, value] = emitted[0] as [{ id: string }, unknown]
      expect(field.id).toBe('modelDirsPrimary')
      expect(value).toBe('/own/models')
      expect(bridge.setModelsDirsCalls).toEqual([])
    })

    it('shows the Downloads tag on the install-own row when its path is the persisted primary', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeStorageSections([], { sharedOn: true, primary: '/own/models' })
      )
      await nextTick()
      // Own row leads while it is the explicit target; shared rows lose the tag.
      const rows = wrapper.findAll('.models-dir-row')
      expect(rows[0]!.find('.models-dir-name').text()).toBe('/own/models')
      expect(rows[0]!.find('.tag-primary').exists()).toBe(true)
      expect(rows.slice(1).every((r) => !r.find('.tag-primary').exists())).toBe(true)
    })
  })

  describe('per-instance input/output (shared I/O off)', () => {
    it('shows the computed defaults with a "default" tag when unset', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(makeIoSections())
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/own/input')
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/own/output')
      expect(rows[0]!.find('.storage-dir-tag').exists()).toBe(true)
      // Per-instance dirs are private: no shared badge.
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(false)
    })

    it('shows the stored override (no default tag) when set', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(makeIoSections({ inputDir: '/ext/in' }))
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/ext/in')
      expect(rows[0]!.find('.storage-dir-tag').exists()).toBe(false)
    })

    it('persists empty when the browsed dir equals the computed default (clone-safe)', async () => {
      const bridge = installMockBridge()
      bridge.browseFolderReturn = '/own/input'
      const wrapper = mountPaneWithSections(makeIoSections())
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-action').trigger('click')
      await flushPromises()
      const [field, value] = wrapper.emitted('update-field')![0] as [{ id: string }, unknown]
      expect(field.id).toBe('inputDir')
      expect(value).toBe('')
    })

    it('persists the override when the browsed dir differs from the default', async () => {
      const bridge = installMockBridge()
      bridge.browseFolderReturn = '/ext/in'
      const wrapper = mountPaneWithSections(makeIoSections())
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-action').trigger('click')
      await flushPromises()
      const [field, value] = wrapper.emitted('update-field')![0] as [{ id: string }, unknown]
      expect(field.id).toBe('inputDir')
      expect(value).toBe('/ext/in')
    })

    it('opens the effective input folder when its path is clicked', async () => {
      const bridge = installMockBridge()
      const wrapper = mountPaneWithSections(makeIoSections({ inputDir: '/ext/in' }))
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-name').trigger('click')
      expect(bridge.openPathCalls).toEqual(['/ext/in'])
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
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: true }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/shared/in')
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/shared/out')
      // Shared dirs are global, not per-instance overrides: no "default" tag.
      expect(rows[0]!.find('.storage-dir-tag').exists()).toBe(false)
      // Shared I/O dirs carry the shared badge for consistency with shared models.
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
      expect(rows[1]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
    })

    it('mixes shared input with a per-instance output independently', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: false }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/shared/in')
      expect(rows[0]!.find('.storage-item-icon.is-shared').exists()).toBe(true)
      // Output stays per-instance: computed default with the "default" tag.
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/own/output')
      expect(rows[1]!.find('.storage-item-icon.is-shared').exists()).toBe(false)
      expect(rows[1]!.find('.storage-dir-tag').exists()).toBe(true)
    })

    it('mixes a per-instance input with shared output independently', async () => {
      installMockBridge()
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
      installMockBridge()
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
      const bridge = installMockBridge()
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: true }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      await wrapper.findAll('.storage-dir-row')[0]!.find('.storage-dir-name').trigger('click')
      expect(bridge.openPathCalls).toEqual(['/shared/in'])
    })

    it('shared rows are read-only: no Browse, manage routes to Desktop Settings', async () => {
      const bridge = installMockBridge()
      bridge.browseFolderReturn = '/picked/in'
      const wrapper = mountPaneWithSections(
        makeIoSections({ sharedInput: true, sharedOutput: true }),
        makeSharedIoSnapshot()
      )
      await nextTick()
      const row = wrapper.findAll('.storage-dir-row')[0]!
      expect(row.find('.storage-dir-action[aria-label^="Browse"]').exists()).toBe(false)
      // The manage action opens Global Desktop Settings; nothing is written from here.
      await row
        .find('.storage-dir-action[aria-label^="Manage Shared Directories"]')
        .trigger('click')
      await flushPromises()
      expect(bridge.openSettingsTabCalls).toEqual(['global'])
      expect(bridge.updateFieldCalls).toEqual([])
      expect(wrapper.emitted('update-field')).toBeUndefined()
    })

    it('browsing a per-instance output updates only the install outputDir field', async () => {
      const bridge = installMockBridge()
      bridge.browseFolderReturn = '/ext/out'
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
      expect(bridge.updateFieldCalls).toEqual([])
    })

    // Older installs without the split fields (and git installs without the
    // section at all) default to shared.
    it('defaults to the shared folders when the toggles are absent', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections([{ fields: [] }] as never, makeSharedIoSnapshot())
      await nextTick()
      const rows = wrapper.findAll('.storage-dir-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.storage-dir-name').text()).toBe('/shared/in')
      expect(rows[1]!.find('.storage-dir-name').text()).toBe('/shared/out')
    })
  })

  // The install's extra_model_paths.yaml is one row in the models list (YAML
  // pill), and clicking it opens a detail modal listing every section's
  // per-type dirs plus a link to the .yaml file.
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
      installMockBridge()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      const extraRow = findExtraRow(wrapper)
      expect(extraRow).toBeTruthy()
      const pill = extraRow.find('.tag-local')
      expect(pill.exists()).toBe(true)
      expect(pill.text()).toContain('YAML')
      // The missing-dir count is intentionally not surfaced in the list.
      expect(extraRow.find('.tag-missing').exists()).toBe(false)
      // Read-only: no browse / make-primary affordance on extra rows.
      expect(extraRow.find('.tag-primary').exists()).toBe(false)
      // The yaml file is per-instance, not shared: no shared badge.
      expect(extraRow.find('.storage-item-icon.is-shared').exists()).toBe(false)
    })

    it('opens the detail modal listing per-type dirs when the row is clicked', async () => {
      installMockBridge()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      expect(document.body.textContent).toContain('/ext/base/checkpoints')
      expect(document.body.textContent).toContain('/ext/base/t2i_adapter')
    })

    it('collapses a multi-section yaml into one row, all sections in the modal', async () => {
      installMockBridge()
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
      // Two sections, but only one row in the list.
      expect(
        wrapper
          .findAll('.models-dir-row')
          .filter((r) => r.text().includes('extra_model_paths.yaml'))
      ).toHaveLength(1)
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      // Both sections' dirs show in the modal.
      expect(document.body.textContent).toContain('/ext/base/checkpoints')
      expect(document.body.textContent).toContain('/nas/models/loras')
      // The default tag appears for the section that declares it.
      expect(document.querySelector('.empm-tag')).toBeTruthy()
    })

    it('reveals the yaml file in its folder from the modal footer', async () => {
      const bridge = installMockBridge()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      const actions = Array.from(document.querySelectorAll('.empm-action')) as HTMLButtonElement[]
      const yamlBtn = actions.find((b) => b.textContent?.includes('.yaml'))!
      yamlBtn.click()
      // Reveal-in-folder, not open-in-default-app.
      expect(bridge.revealPathCalls).toContain('/own/extra_model_paths.yaml')
      expect(bridge.openPathCalls).not.toContain('/own/extra_model_paths.yaml')
    })

    it('opens a per-type dir from the modal when its path is clicked', async () => {
      const bridge = installMockBridge()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      const dirBtns = Array.from(document.querySelectorAll('.empm-dir-path')) as HTMLButtonElement[]
      dirBtns.find((b) => b.textContent === '/ext/base/checkpoints')!.click()
      expect(bridge.openPathCalls).toContain('/ext/base/checkpoints')
    })

    it('marks a missing per-type dir red (is-missing) instead of a badge', async () => {
      installMockBridge()
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
      installMockBridge()
      const wrapper = mountPaneWithSections(sectionsWithExtra(extraView()))
      await nextTick()
      await findExtraRow(wrapper).find('.models-dir-name').trigger('click')
      await nextTick()
      ;(document.querySelector('.empm-refresh') as HTMLButtonElement).click()
      expect(wrapper.emitted('refresh')).toHaveLength(1)
    })
  })
})
