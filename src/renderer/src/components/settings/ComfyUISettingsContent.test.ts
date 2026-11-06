import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { computed, ref, nextTick } from 'vue'

import type { Installation } from '../../types/ipc'
import { useSessionStore } from '../../stores/sessionStore'
import { TID } from '../../../../shared/testIds'

const useComfyUISettingsState = {
  pinBottomActions: ref<{ id: string; label: string }[]>([{ id: 'untrack', label: 'Forget' }]),
  sections: ref<unknown[]>([
    { tab: 'update', fields: [] },
    { tab: 'status', fields: [] },
    { tab: 'snapshots' }
  ]),
  loading: ref(false),
  error: ref<null>(null),
  sectionsFresh: ref<boolean>(true),
  runningActionIds: ref<Set<string>>(new Set()),
  pendingRestartFieldIds: ref<Set<string>>(new Set()),
  fieldErrorMessages: ref<Record<string, string>>({}),
  diskUsageItem: ref(null),
  runActionStub: vi.fn()
}
vi.mock('../../composables/useComfyUISettings', () => ({
  useComfyUISettings: () => ({
    ...useComfyUISettingsState,
    updateField: vi.fn(),
    runAction: useComfyUISettingsState.runActionStub,
    sectionsForTab: (tab: string) =>
      computed(() => {
        const hasTab = useComfyUISettingsState.sections.value.some(
          (s) => (s as { tab?: string }).tab === tab
        )
        return hasTab ? [{ tab, fields: [] }] : []
      }),
    reload: vi.fn()
  })
}))

vi.mock('../../views/comfyUISettings/SnapshotsView.vue', () => ({
  default: {
    name: 'SnapshotsView',
    emits: ['op-cancel', 'op-retry', 'op-dismiss', 'run-action', 'refresh-all'],
    template: '<div data-testid="snapshots-view-stub"></div>'
  }
}))
vi.mock('../../views/comfyUISettings/SettingsSectionList.vue', () => ({
  default: { template: '<div data-testid="settings-section-list-stub"></div>' }
}))
vi.mock('../../views/comfyUISettings/StatusFactPanel.vue', () => ({
  default: { template: '<div />' }
}))
vi.mock('../../views/comfyUISettings/StoragePane.vue', () => ({
  default: { template: '<div />' }
}))
vi.mock('../../views/comfyUISettings/ConsoleTerminalPane.vue', () => ({
  default: {
    name: 'ConsoleTerminalPane',
    props: ['installationId'],
    template: '<div data-testid="console-terminal-pane-stub" />'
  }
}))
vi.mock('../../views/comfyUISettings/ArgsBuilderPage.vue', () => ({
  default: { template: '<div />' }
}))
vi.mock('../../views/comfyUISettings/MoreMenu.vue', () => ({
  default: {
    name: 'MoreMenu',
    props: ['open', 'actions'],
    template: '<div v-if="open" data-testid="more-menu">menu</div>'
  }
}))

const SAMPLE_INSTALL: Installation = {
  id: 'inst-1',
  name: 'My Install',
  sourceId: 'standalone',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed'
} as unknown as Installation

async function mountContent(props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const { default: ComfyUISettingsContent } = await import('./ComfyUISettingsContent.vue')
  const pinia = getActivePinia() ?? createPinia()
  const wrapper = mount(ComfyUISettingsContent, {
    props: {
      installation: SAMPLE_INSTALL,
      initialTab: 'update',
      activeOperation: null,
      ...props
    },
    global: { plugins: [pinia] }
  }) as VueWrapper
  await flushPromises()
  return wrapper
}

describe('ComfyUISettingsContent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      onErrorDetail: vi.fn(() => () => {}),
      onInstanceProgress: vi.fn(() => () => {}),
      getDiskSpace: vi.fn().mockResolvedValue(null)
    }
    useComfyUISettingsState.pinBottomActions.value = [{ id: 'untrack', label: 'Forget' }]
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('overlay title — isDowngrade branch', () => {
    it('moves its actions into the page header when hosted as a page', async () => {
      const target = document.createElement('div')
      target.id = 'page-actions'
      document.body.append(target)

      const wrapper = await mountContent({ pageActionsTarget: '#page-actions' })
      await flushPromises()

      expect(target.querySelector('.settings-v2-footer')).not.toBeNull()
      expect(wrapper.find('.settings-v2-footer').exists()).toBe(false)

      wrapper.unmount()
      target.remove()
    })

    it('renders "Updating…" when actionData.isDowngrade is false', async () => {
      const w = await mountContent({
        activeOperation: {
          actionId: 'update-comfyui',
          actionData: { isDowngrade: false },
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: 'Fetching…',
          cancellable: false,
          title: ''
        }
      })
      expect(w.find('.op-title').text()).toBe('Updating…')
    })

    it('renders "Downgrading…" when actionData.isDowngrade is true', async () => {
      const w = await mountContent({
        activeOperation: {
          actionId: 'update-comfyui',
          actionData: { isDowngrade: true },
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: 'Fetching…',
          cancellable: false,
          title: ''
        }
      })
      expect(w.find('.op-title').text()).toBe('Downgrading…')
    })

    it('success title says "Downgrade complete" when isDowngrade is true', async () => {
      const w = await mountContent({
        activeOperation: {
          actionId: 'update-comfyui',
          actionData: { isDowngrade: true },
          done: true,
          ok: true,
          error: null,
          percent: 100,
          status: 'Complete',
          cancellable: false,
          title: ''
        }
      })
      expect(w.find('.op-title').text()).toBe('Downgrade complete')
    })

    it('success title says "Update complete" when isDowngrade is false', async () => {
      const w = await mountContent({
        activeOperation: {
          actionId: 'update-comfyui',
          actionData: { isDowngrade: false },
          done: true,
          ok: true,
          error: null,
          percent: 100,
          status: 'Complete',
          cancellable: false,
          title: ''
        }
      })
      expect(w.find('.op-title').text()).toBe('Update complete')
    })
  })

  describe('error overlay', () => {
    it('renders the full multi-line error message with a copy button', async () => {
      const detail = [
        'Update process failed with exit code 1.',
        '',
        'Traceback (most recent call last):',
        '  File "main.py", line 42, in <module>',
        'ModuleNotFoundError: No module named "foo"'
      ].join('\n')
      const w = await mountContent({
        activeOperation: {
          actionId: 'update-comfyui',
          actionData: {},
          done: true,
          ok: false,
          error: detail,
          percent: 100,
          status: '',
          cancellable: false,
          title: ''
        }
      })
      const msg = w.find(`[data-testid="${TID.pickerOpErrorMessage}"]`)
      expect(msg.exists()).toBe(true)
      expect(msg.text()).toContain('Update process failed with exit code 1.')
      expect(msg.text()).toContain('ModuleNotFoundError: No module named "foo"')
      expect(w.find(`[data-testid="${TID.pickerOpErrorCopy}"]`).exists()).toBe(true)
    })
  })

  describe('overlay routing', () => {
    it('does NOT render the overlay for snapshot-restore on the snapshots tab', async () => {
      const w = await mountContent({
        initialTab: 'snapshots',
        activeOperation: {
          actionId: 'snapshot-restore',
          actionData: { file: 'snap-1.json' },
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: 'Loading snapshot…',
          cancellable: true,
          title: ''
        }
      })
      expect(w.find('.op-overlay').exists()).toBe(false)
    })

    it('auto-switches to the snapshots tab when a snapshot-restore op starts on another tab', async () => {
      const w = await mountContent({
        initialTab: 'update',
        activeOperation: {
          actionId: 'snapshot-restore',
          actionData: { file: 'snap-1.json' },
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: 'Loading snapshot…',
          cancellable: true,
          title: ''
        }
      })
      expect(w.find('[data-testid="snapshots-view-stub"]').exists()).toBe(true)
      expect(w.find('.op-overlay').exists()).toBe(false)
    })

    it('auto-switches to the Update tab when a non-snapshot op starts on the snapshots tab', async () => {
      const w = await mountContent({
        initialTab: 'snapshots',
        activeOperation: {
          actionId: 'copy',
          actionData: {},
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: '',
          cancellable: true,
          title: ''
        }
      })
      expect(w.find('[data-testid="snapshots-view-stub"]').exists()).toBe(false)
      expect(w.find('.op-overlay').exists()).toBe(true)
      expect(w.find('.op-title').text()).toBe('Copying…')
    })

    it('switches to the op home tab when selecting an already-operating install', async () => {
      const w = await mountContent({ initialTab: 'snapshots', activeOperation: null })
      expect(w.find('[data-testid="snapshots-view-stub"]').exists()).toBe(true)

      await w.setProps({
        installation: { ...SAMPLE_INSTALL, id: 'inst-2' },
        activeOperation: {
          actionId: 'release-update',
          actionData: {},
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: '',
          cancellable: true,
          title: ''
        }
      })
      await flushPromises()
      expect(w.find('[data-testid="snapshots-view-stub"]').exists()).toBe(false)
      expect(w.find('.op-overlay').exists()).toBe(true)
      expect(w.find('.op-title').text()).toBe('Updating…')
    })

    it('renders the overlay on the Update tab when a copy op is in flight', async () => {
      const w = await mountContent({
        initialTab: 'update',
        activeOperation: {
          actionId: 'copy',
          actionData: {},
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: '',
          cancellable: true,
          title: ''
        }
      })
      expect(w.find('.op-overlay').exists()).toBe(true)
      expect(w.find('.op-title').text()).toBe('Copying…')
    })
  })

  describe('overlay title — per-action labels', () => {
    it.each([
      ['copy', { actionData: {} }, 'Copying…', 'Copy complete'],
      ['copy-update', { actionData: {} }, 'Copying & updating…', 'Copy complete'],
      ['delete', { actionData: {} }, 'Deleting…', 'Deleted'],
      ['release-update', { actionData: {} }, 'Updating…', 'Update complete'],
      ['migrate-to-standalone', { actionData: {} }, 'Migrating…', 'Migration complete']
    ])('actionId=%s → in-flight %s / success %s', async (actionId, extras, inflight, success) => {
      const wIn = await mountContent({
        activeOperation: {
          actionId,
          ...extras,
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: '',
          cancellable: false,
          title: ''
        }
      })
      expect(wIn.find('.op-title').text()).toBe(inflight)

      const wDone = await mountContent({
        activeOperation: {
          actionId,
          ...extras,
          done: true,
          ok: true,
          error: null,
          percent: 100,
          status: 'Complete',
          cancellable: false,
          title: ''
        }
      })
      expect(wDone.find('.op-title').text()).toBe(success)
    })
  })

  describe('More button', () => {
    it('is enabled when no op is in flight', async () => {
      const w = await mountContent()
      const moreBtn = w.find('.settings-v2-more')
      expect(moreBtn.exists()).toBe(true)
      expect(moreBtn.attributes('disabled')).toBeUndefined()
    })

    it('disables when an op is in flight', async () => {
      const w = await mountContent({
        activeOperation: {
          actionId: 'update-comfyui',
          actionData: {},
          done: false,
          ok: null,
          error: null,
          percent: 30,
          status: '',
          cancellable: false,
          title: ''
        }
      })
      const moreBtn = w.find('.settings-v2-more')
      expect(moreBtn.attributes('disabled')).toBeDefined()
    })

    it('auto-closes an open menu when an op begins mid-interaction', async () => {
      const w = await mountContent()
      await w.find('.settings-v2-more').trigger('click')
      await nextTick()
      expect(w.find('[data-testid="more-menu"]').exists()).toBe(true)

      await w.setProps({
        activeOperation: {
          actionId: 'update-comfyui',
          actionData: {},
          done: false,
          ok: null,
          error: null,
          percent: 0,
          status: '',
          cancellable: false,
          title: ''
        }
      })
      await flushPromises()
      expect(w.find('[data-testid="more-menu"]').exists()).toBe(false)
    })
  })

  describe('tab tooltips (#702 concept tooltips + #713 — no redundant label echo)', () => {
    type ResizeCb = (entries: ResizeObserverEntry[], obs: ResizeObserver) => void
    interface RoHandle {
      el: Element
      fire(width: number): void
    }
    let roHandles: RoHandle[]
    let originalRo: typeof globalThis.ResizeObserver | undefined

    beforeEach(() => {
      roHandles = []
      class StubRo {
        cb: ResizeCb
        constructor(cb: ResizeCb) {
          this.cb = cb
        }
        observe(el: Element): void {
          roHandles.push({
            el,
            fire: (width: number) => {
              this.cb(
                [{ contentRect: { width, height: 44 } as DOMRectReadOnly } as ResizeObserverEntry],
                this as unknown as ResizeObserver
              )
            }
          })
        }
        disconnect(): void {}
        unobserve(): void {}
      }
      originalRo = (globalThis as { ResizeObserver?: typeof globalThis.ResizeObserver })
        .ResizeObserver
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
        StubRo as unknown as typeof globalThis.ResizeObserver
    })
    afterEach(() => {
      if (originalRo) {
        ;(globalThis as { ResizeObserver?: typeof globalThis.ResizeObserver }).ResizeObserver =
          originalRo
      } else {
        delete (globalThis as { ResizeObserver?: typeof globalThis.ResizeObserver }).ResizeObserver
      }
    })

    const SNAPSHOTS_TOOLTIP =
      'A saved point-in-time state of an instance (versions + custom nodes) you can restore later.'
    const CONSOLE_TOOLTIP =
      "An interactive shell running in this instance's folder. Works whether ComfyUI is running or stopped."

    const TAB_LABELS = new Set([
      'Update',
      'Startup Args',
      'Snapshots',
      'Storage',
      'Terminal',
      'About'
    ])

    function tabTooltips(w: VueWrapper) {
      return w
        .findAllComponents({ name: 'Tooltip' })
        .filter((tt) => !TAB_LABELS.has(tt.props('text') as string))
    }

    it('wires a concept tooltip on every install-settings tab (no label-echo fallback in use)', async () => {
      const w = await mountContent()
      roHandles.forEach((h) => h.fire(900))
      await nextTick()
      const allTabTooltips = w.findAllComponents({ name: 'Tooltip' })
      const concept = tabTooltips(w)
      expect(concept.length).toBe(allTabTooltips.length)
      expect(concept.length).toBeGreaterThan(0)
      const texts = concept.map((tt) => tt.props('text') as string)
      expect(texts).toContain(SNAPSHOTS_TOOLTIP)
      expect(texts).toContain(CONSOLE_TOOLTIP)
      expect(concept.every((tt) => tt.props('disabled') === false)).toBe(true)
    })

    it('always shows the Snapshots concept tooltip regardless of strip width', async () => {
      const w = await mountContent({ initialTab: 'snapshots' })
      const snapshotTip = () =>
        w
          .findAllComponents({ name: 'Tooltip' })
          .find((tt) => tt.props('text') === SNAPSHOTS_TOOLTIP)
      roHandles.forEach((h) => h.fire(900))
      await nextTick()
      expect(snapshotTip()?.props('disabled')).toBe(false)
      roHandles.forEach((h) => h.fire(300))
      await nextTick()
      expect(snapshotTip()?.props('disabled')).toBe(false)
    })

    it('keeps every tab tooltip live when the strip collapses to icon-only', async () => {
      const w = await mountContent({ initialTab: 'update' })
      roHandles.forEach((h) => h.fire(300))
      await nextTick()
      const tips = tabTooltips(w)
      expect(tips.length).toBeGreaterThan(0)
      expect(tips.every((tt) => tt.props('disabled') === false)).toBe(true)
    })
  })

  describe('footer primary action — running scope (issue #749)', () => {
    function markRunning(installId: string): void {
      const store = useSessionStore()
      store.runningInstances.set(installId, {
        installationId: installId,
        installationName: 'X',
        mode: ''
      })
    }

    function emittedDecision(wrapper: VueWrapper) {
      const calls = wrapper.emitted('primary-action') as unknown[][] | undefined
      return calls?.[0]?.[0] as { window: string; verb: string } | undefined
    }

    it('labels "Start" and emits a same-window switch decision when not running', async () => {
      const w = await mountContent({
        currentView: 'dashboard',
        currentCategory: null,
        activeInstallationId: null
      })
      expect(w.find('.settings-v2-relaunch').text()).toBe('Start')
      await w.find('.settings-v2-relaunch').trigger('click')
      expect(emittedDecision(w)).toMatchObject({ window: 'same', verb: 'switch' })
    })

    it('labels "Restart" and emits a restart decision when running in THIS window', async () => {
      markRunning('inst-1')
      const w = await mountContent({
        currentView: 'instance',
        currentCategory: 'local',
        activeInstallationId: 'inst-1'
      })
      expect(w.find('.settings-v2-relaunch').text()).toBe('Restart')
      await w.find('.settings-v2-relaunch').trigger('click')
      expect(emittedDecision(w)).toMatchObject({ window: 'same', verb: 'restart' })
    })

    it('labels "Switch" and emits a focus decision when running in ANOTHER window', async () => {
      markRunning('inst-1')
      const w = await mountContent({
        currentView: 'instance',
        currentCategory: 'local',
        activeInstallationId: 'other'
      })
      expect(w.find('.settings-v2-relaunch').text()).toBe('Switch')
      await w.find('.settings-v2-relaunch').trigger('click')
      expect(emittedDecision(w)).toMatchObject({ verb: 'focus' })
    })

    it('treats a running install as "Switch" on an install-less (dashboard) host', async () => {
      markRunning('inst-1')
      const w = await mountContent({
        currentView: 'dashboard',
        currentCategory: null,
        activeInstallationId: null
      })
      expect(w.find('.settings-v2-relaunch').text()).toBe('Switch')
      await w.find('.settings-v2-relaunch').trigger('click')
      expect(emittedDecision(w)).toMatchObject({ verb: 'focus' })
    })
  })

  describe('caret for a running-elsewhere target', () => {
    function markRunning(installId: string): void {
      useSessionStore().runningInstances.set(installId, {
        installationId: installId,
        installationName: 'X',
        mode: ''
      })
    }
    function caretActions(wrapper: VueWrapper): { id: string }[] | undefined {
      if (!wrapper.find('.settings-v2-cta-caret').exists()) return undefined
      const menu = wrapper
        .findAllComponents({ name: 'MoreMenu' })
        .map((m) => m.props('actions') as { id: string }[] | undefined)
        .find((acts) => acts?.some((a) => a.id === 'stop' || a.id.startsWith('nav:')))
      return menu
    }

    it('remote running elsewhere → caret offers Stop, not "Open in new window"', async () => {
      useComfyUISettingsState.pinBottomActions.value = [{ id: 'stop', label: 'Stop' }]
      markRunning('inst-1')
      const w = await mountContent({
        currentView: 'instance',
        currentCategory: 'local',
        activeInstallationId: 'other',
        installation: { ...SAMPLE_INSTALL, sourceCategory: 'remote' }
      })
      expect(w.find('.settings-v2-relaunch').text()).toBe('Switch')
      const actions = caretActions(w)
      expect(actions?.map((a) => a.id)).toEqual(['stop'])
    })

    it('cloud running elsewhere → no caret (cloud has no stop action)', async () => {
      useComfyUISettingsState.pinBottomActions.value = []
      markRunning('inst-1')
      const w = await mountContent({
        currentView: 'instance',
        currentCategory: 'local',
        activeInstallationId: 'other',
        installation: { ...SAMPLE_INSTALL, sourceCategory: 'cloud' }
      })
      expect(w.find('.settings-v2-relaunch').text()).toBe('Switch')
      expect(w.find('.settings-v2-cta-caret').exists()).toBe(false)
    })

    it('stopped cloud target (dashboard host) → caret still offers "Open in new window"', async () => {
      useComfyUISettingsState.pinBottomActions.value = []
      const w = await mountContent({
        currentView: 'dashboard',
        currentCategory: null,
        activeInstallationId: null,
        installation: { ...SAMPLE_INSTALL, sourceCategory: 'cloud' }
      })
      const actions = caretActions(w)
      expect(actions?.some((a) => a.id.startsWith('nav:'))).toBe(true)
    })
  })

  describe('switch staleness (#782)', () => {
    function setStale(value: boolean): void {
      useComfyUISettingsState.sectionsFresh.value = !value
    }

    it('does NOT show the "Loading…" placeholder when sections are still painted (fresh OR stale)', async () => {
      setStale(true)
      useComfyUISettingsState.loading.value = true
      const w = await mountContent()
      expect(w.find('[data-testid="picker-settings-loading"]').exists()).toBe(false)
      expect(w.find('[data-testid="picker-settings-sections"]').exists()).toBe(true)
      useComfyUISettingsState.loading.value = false
    })

    it('still shows the "Loading…" placeholder on a true first load (no prior sections)', async () => {
      const priorSections = useComfyUISettingsState.sections.value
      useComfyUISettingsState.sections.value = []
      useComfyUISettingsState.loading.value = true
      const w = await mountContent()
      expect(w.find('[data-testid="picker-settings-loading"]').exists()).toBe(true)
      useComfyUISettingsState.sections.value = priorSections
      useComfyUISettingsState.loading.value = false
    })

    it("marks the body root .is-stale while the new install's sections are still in flight", async () => {
      setStale(true)
      const w = await mountContent()
      const root = w.find('[data-testid="picker-settings-sections"]')
      expect(root.classes()).toContain('is-stale')
      setStale(false)
      await nextTick()
      expect(root.classes()).not.toContain('is-stale')
    })

    it('disables the footer More menu while sections are stale, re-enables when fresh', async () => {
      setStale(true)
      const w = await mountContent()
      const more = w.find('.settings-v2-more')
      expect((more.element as HTMLButtonElement).disabled).toBe(true)
      setStale(false)
      await nextTick()
      expect((more.element as HTMLButtonElement).disabled).toBe(false)
    })

    it('does NOT auto-fire `check-update` against the new install while sections are still stale', async () => {
      const priorSections = useComfyUISettingsState.sections.value
      useComfyUISettingsState.sections.value = [
        {
          tab: 'update',
          fields: [{ id: 'channel', editType: 'channel-cards', value: 'stable' }],
          actions: [{ id: 'check-update', label: 'Check for update', data: {} }]
        }
      ]
      setStale(true)
      useComfyUISettingsState.runActionStub.mockClear()

      await mountContent({ initialTab: 'update' })

      expect(useComfyUISettingsState.runActionStub).not.toHaveBeenCalled()

      useComfyUISettingsState.sections.value = priorSections
    })

    it('does NOT latch onto the Console tab when a local install retargets through stale/empty sections', async () => {
      const priorSections = useComfyUISettingsState.sections.value
      const fullSections = [
        { tab: 'update', fields: [] },
        { tab: 'settings', fields: [] },
        { tab: 'storage', fields: [] },
        { tab: 'status', fields: [] }
      ]
      useComfyUISettingsState.sectionsFresh.value = true
      useComfyUISettingsState.sections.value = fullSections
      const w = await mountContent({ initialTab: 'update' })
      expect(w.find('[data-testid="console-terminal-pane-stub"]').exists()).toBe(false)

      useComfyUISettingsState.sections.value = []
      useComfyUISettingsState.sectionsFresh.value = false
      await nextTick()
      expect(w.find('[data-testid="console-terminal-pane-stub"]').exists()).toBe(false)

      useComfyUISettingsState.sections.value = fullSections
      useComfyUISettingsState.sectionsFresh.value = true
      await nextTick()
      expect(w.find('[data-testid="console-terminal-pane-stub"]').exists()).toBe(false)

      useComfyUISettingsState.sections.value = priorSections
      useComfyUISettingsState.sectionsFresh.value = true
    })
  })

  describe('Update-tab auto-refresh staleness gate', () => {
    async function checkUpdateFireCount(lastCheckedAt?: number): Promise<number> {
      const priorSections = useComfyUISettingsState.sections.value
      useComfyUISettingsState.sections.value = [
        {
          tab: 'update',
          fields: [
            {
              id: 'channel',
              editType: 'channel-cards',
              value: 'stable',
              options: [{ value: 'stable', label: 'Stable', data: { lastCheckedAt } }]
            }
          ],
          actions: [{ id: 'check-update', label: 'Check for update', data: {} }]
        }
      ]
      useComfyUISettingsState.sectionsFresh.value = true
      useComfyUISettingsState.runActionStub.mockClear()

      await mountContent({ initialTab: 'update' })

      const count = useComfyUISettingsState.runActionStub.mock.calls.filter(
        (c) => (c[0] as { id?: string } | undefined)?.id === 'check-update'
      ).length
      useComfyUISettingsState.sections.value = priorSections
      return count
    }

    it('does NOT fire check-update when the selected card is fresh', async () => {
      expect(await checkUpdateFireCount(Date.now())).toBe(0)
    })

    it('fires check-update when the selected card is older than the staleness window', async () => {
      expect(await checkUpdateFireCount(Date.now() - 16 * 60 * 1000)).toBeGreaterThanOrEqual(1)
    })

    it('fires check-update when the selected card has never been checked', async () => {
      expect(await checkUpdateFireCount(undefined)).toBeGreaterThanOrEqual(1)
    })
  })

  describe('install-switch transition cue', () => {
    it('remounts the inner tab pane when the installation changes (same tab)', async () => {
      const w = await mountContent({ initialTab: 'status' })
      const paneBefore = w.find('.settings-v2-tab-pane').element
      expect(paneBefore).toBeTruthy()

      const other = {
        ...SAMPLE_INSTALL,
        id: 'inst-2',
        name: 'Other Install'
      } as unknown as Installation
      await w.setProps({ installation: other })
      await flushPromises()

      const paneAfter = w.find('.settings-v2-tab-pane').element
      expect(paneAfter).toBeTruthy()
      expect(paneAfter).not.toBe(paneBefore)
    })
  })

  describe('op-event relay from SnapshotsView', () => {
    it('forwards op-cancel / op-retry / op-dismiss up to the host', async () => {
      const w = await mountContent({ initialTab: 'snapshots' })
      const snapshotsStub = w.findComponent({ name: 'SnapshotsView' })
      expect(snapshotsStub.exists()).toBe(true)

      snapshotsStub.vm.$emit('op-cancel')
      snapshotsStub.vm.$emit('op-retry')
      snapshotsStub.vm.$emit('op-dismiss')
      await flushPromises()

      expect(w.emitted('op-cancel')).toHaveLength(1)
      expect(w.emitted('op-retry')).toHaveLength(1)
      expect(w.emitted('op-dismiss')).toHaveLength(1)
    })
  })
})
