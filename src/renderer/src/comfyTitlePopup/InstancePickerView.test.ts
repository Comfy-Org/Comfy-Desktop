import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../stores/sessionStore'

import { NAV_LABEL, type NavDecision } from '../../../shared/navigation/navDecision'
import InstancePickerView from './InstancePickerView.vue'

const OPEN_NEW_DECISION: NavDecision = {
  window: 'new',
  verb: 'open-new',
  primaryLabel: NAV_LABEL.start,
  secondary: [],
  telemetry: null
}
const RESTART_DECISION: NavDecision = {
  window: 'same',
  verb: 'restart',
  primaryLabel: NAV_LABEL.restart,
  secondary: [],
  telemetry: null
}
const FOCUS_DECISION: NavDecision = {
  window: 'same',
  verb: 'focus',
  primaryLabel: NAV_LABEL.switch,
  secondary: [],
  telemetry: null
}
import type { SnapshotListData } from '../types/ipc'

vi.mock('../views/comfyUISettings/ConsoleTerminalPane.vue', () => ({
  default: {
    name: 'ConsoleTerminalPane',
    props: ['installationId'],
    template: '<div data-testid="console-terminal-pane-stub" />'
  }
}))

const emptySnapshotListPayload: SnapshotListData = {
  snapshots: [],
  copyEvents: [],
  totalCount: 0,
  context: {
    updateChannel: 'stable',
    pythonVersion: '3.12',
    variant: 'cpu',
    variantLabel: 'CPU'
  }
}

;(window as unknown as { api: Record<string, unknown> }).api = {
  onErrorDetail: vi.fn(() => () => {}),
  onInstanceStarted: vi.fn(() => () => {}),
  onInstanceStopped: vi.fn(() => () => {}),
  onInstanceProgress: vi.fn(() => () => {}),
  onSessionStateChanged: vi.fn(() => () => {}),
  getDetailSections: vi.fn().mockResolvedValue([]),
  getDiskSpace: vi.fn().mockResolvedValue(null),
  getInstallationSize: vi.fn().mockResolvedValue({ sizeBytes: 0 })
}

interface MockInstall {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  version?: string
  lastLaunchedAt?: number
  installPath?: string
  status?: string
  statusTag?: { style: string; label: string }
}

interface MockSnapshot {
  installs: MockInstall[]
  activeInstallationId: string | null
  runningInstallationIds: string[]
  runningSessionStartedAt?: Record<string, number>
  launchingInstallationIds?: string[]
  selectedInstallationId?: string | null
  pickerSelectionEpoch?: number
  selectedSettings?: unknown[] | null
  selectedSnapshots?: unknown | null
}

interface BridgeState {
  picks: string[]
  newWindows: string[]
  restarts: { id: string; opts?: { confirmed?: boolean } }[]
  backgroundOps: { installationId: string; actionId: string }[]
  newInstallCount: number
  selectedInstallSets: (string | null)[]
  updateFieldCalls: { installationId: string; fieldId: string; value: unknown }[]
  runActionCalls: { installationId: string; actionId: string; actionData?: unknown }[]
}

function installMockBridge(): BridgeState {
  const state: BridgeState = {
    picks: [],
    newWindows: [],
    restarts: [],
    backgroundOps: [],
    newInstallCount: 0,
    selectedInstallSets: [],
    updateFieldCalls: [],
    runActionCalls: []
  }
  const bridge = {
    pickInstall: (id: string) => {
      state.picks.push(id)
    },
    openInstallNewWindow: (id: string) => {
      state.newWindows.push(id)
    },
    restartInstall: (id: string, opts?: { confirmed?: boolean }) => {
      state.restarts.push({ id, opts })
    },
    openNewInstall: () => {
      state.newInstallCount += 1
    },
    openSettingsTab: vi.fn(),
    setPickerSelectedInstall: (id: string | null) => {
      state.selectedInstallSets.push(id)
    },
    pickerUpdateField: vi.fn(async (installationId: string, fieldId: string, value: unknown) => {
      state.updateFieldCalls.push({ installationId, fieldId, value })
      return { ok: true }
    }),
    pickerRunAction: vi.fn(
      async (installationId: string, actionId: string, actionData?: unknown) => {
        state.runActionCalls.push({ installationId, actionId, actionData })
        return { ok: true }
      }
    ),
    pickerStartBackgroundOp: (opts: { installationId: string; actionId: string }) => {
      state.backgroundOps.push(opts)
    },
    pickerSettingsGetLocaleMessages: vi.fn(async () => ({})),
    pickerSettingsGetLocale: vi.fn(async () => 'en'),
    pickerSettingsOnLocaleChanged: vi.fn(() => () => {})
  }
  ;(window as unknown as { __comfyTitlePopup: typeof bridge }).__comfyTitlePopup = bridge
  return state
}

function makeInstall(overrides: Partial<MockInstall>): MockInstall {
  return {
    id: 'inst-x',
    name: 'X',
    sourceLabel: 'Standalone',
    sourceCategory: 'local',
    ...overrides
  }
}

async function mountPicker(snapshot: MockSnapshot) {
  const pinia = createPinia()
  const enriched = {
    selectedInstallationId: snapshot.activeInstallationId,
    selectedSettings: null,
    selectedSnapshots: emptySnapshotListPayload,
    launchingInstallationIds: [] as string[],
    ...snapshot
  }
  return mount(InstancePickerView, {
    props: {
      snapshot: enriched,
      globalSettingsSnapshot: {
        sharedDirectoriesFields: [],
        modelsDirs: [],
        modelsSystemDefault: ''
      }
    },
    global: { plugins: [pinia] }
  })
}

describe('comfyTitlePopup/InstancePickerView', () => {
  let bridge: BridgeState

  beforeEach(() => {
    setActivePinia(createPinia())
    bridge = installMockBridge()
  })

  describe('structural shell', () => {
    it('renders the search input, chip row, and split panes', async () => {
      const wrapper = await mountPicker({
        installs: [],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      const input = wrapper.get('.picker-search input')
      expect(input.attributes('placeholder')).toBe('Search builds')
      expect(input.attributes('aria-label')).toBe('Search builds')
      expect(wrapper.findAll('.picker-chip').length).toBeGreaterThan(0)
      expect(wrapper.find('.picker-list').exists()).toBe(true)
      expect(wrapper.find('.picker-detail-wrap.is-expanded').exists()).toBe(true)
    })

    it('labels the list Builds and leaves build creation on the dashboard', async () => {
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      expect(wrapper.get('.picker-list-section-title').text()).toBe('Builds')
      expect(wrapper.find('.picker-new-install').exists()).toBe(false)
      expect(wrapper.find('.picker-left-footer').exists()).toBe(false)
    })
  })

  describe('row rendering', () => {
    it('orders install rows by recency desc with never-launched last', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({ id: 'old', name: 'Old', lastLaunchedAt: 100 }),
          makeInstall({ id: 'new', name: 'New', lastLaunchedAt: 500 }),
          makeInstall({ id: 'never', name: 'Never' })
        ],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      const namesInOrder = wrapper.findAll('.picker-row-name').map((n) => n.text())
      expect(namesInOrder).toEqual(['New', 'Old', 'Never'])
    })

    it('places a cloud row below a more-recent local row (no cloud pinning)', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({
            id: 'old-cloud',
            name: 'OldCloud',
            sourceCategory: 'cloud',
            sourceLabel: 'Cloud',
            lastLaunchedAt: 100
          }),
          makeInstall({
            id: 'recent-local',
            name: 'RecentLocal',
            sourceCategory: 'local',
            lastLaunchedAt: 1_000
          })
        ],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      const namesInOrder = wrapper.findAll('.picker-row-name').map((n) => n.text())
      expect(namesInOrder).toEqual(['RecentLocal', 'OldCloud'])
    })

    it('marks running rows with the is-running class', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({ id: 'a', name: 'Alpha' }),
          makeInstall({ id: 'b', name: 'Bravo' })
        ],
        activeInstallationId: null,
        runningInstallationIds: ['a']
      })
      const rows = wrapper.findAll('.picker-row')
      const alphaRow = rows.find((c) => c.text().includes('Alpha'))
      expect(alphaRow!.classes()).toContain('is-running')
    })

    it("carries each running session's start time into the session store, renewing it on restart", async () => {
      const snapshot = {
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: null,
        runningInstallationIds: ['a'],
        runningSessionStartedAt: { a: 100 }
      }
      const wrapper = await mountPicker(snapshot)
      const store = useSessionStore()
      expect(store.runningInstances.get('a')?.startedAt).toBe(100)

      await wrapper.setProps({
        snapshot: {
          ...wrapper.props('snapshot'),
          runningSessionStartedAt: { a: 200 }
        }
      })
      expect(store.runningInstances.get('a')?.startedAt).toBe(200)
    })

    it('selects a row on click without launching', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({ id: 'a', name: 'Alpha' }),
          makeInstall({ id: 'b', name: 'Bravo' })
        ],
        activeInstallationId: 'a',
        runningInstallationIds: []
      })
      const bravoRow = wrapper.findAll('.picker-row').find((c) => c.text().includes('Bravo'))
      await bravoRow!.trigger('click')
      await flushPromises()
      expect(bridge.picks).toEqual([])
      expect(bridge.selectedInstallSets.at(-1)).toBe('b')
    })

    it('renders the Current pill on the active-host install and only there', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({ id: 'a', name: 'Alpha', lastLaunchedAt: Date.now() - 60_000 }),
          makeInstall({ id: 'b', name: 'Bravo', lastLaunchedAt: Date.now() - 3_600_000 })
        ],
        activeInstallationId: 'a',
        runningInstallationIds: []
      })
      const rows = wrapper.findAll('.picker-row')
      const alphaRow = rows.find((c) => c.text().includes('Alpha'))!
      const bravoRow = rows.find((c) => c.text().includes('Bravo'))!
      expect(alphaRow.find('.picker-row-current-pill').exists()).toBe(true)
      expect(alphaRow.find('.picker-row-recency').exists()).toBe(false)
      expect(bravoRow.find('.picker-row-current-pill').exists()).toBe(false)
      expect(bravoRow.find('.picker-row-recency').exists()).toBe(true)
    })

    it('paints the row dot orange when update available, including when also running', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({
            id: 'a',
            name: 'Alpha',
            statusTag: { style: 'update', label: 'Update' }
          }),
          makeInstall({ id: 'b', name: 'Bravo' })
        ],
        activeInstallationId: null,
        runningInstallationIds: ['a']
      })
      const rows = wrapper.findAll('.picker-row')
      const alphaRow = rows.find((c) => c.text().includes('Alpha'))!
      expect(alphaRow.find('.picker-row-update-dot').exists()).toBe(true)
      expect(alphaRow.find('.picker-row-running-dot').exists()).toBe(false)
      const bravoRow = rows.find((c) => c.text().includes('Bravo'))!
      expect(bravoRow.find('.picker-row-update-dot').exists()).toBe(false)
      expect(bravoRow.find('.picker-row-running-dot').exists()).toBe(false)
    })
  })

  describe('home icon', () => {
    it('renders Home only when the picker is hosted by an install', async () => {
      const installHost = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: 'a',
        runningInstallationIds: []
      })
      expect(installHost.find('.picker-home').exists()).toBe(true)

      const chooserHost = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      expect(chooserHost.find('.picker-home').exists()).toBe(false)
    })

    it('routes dashboard-button clicks through bridge.activate("new-window") so the running instance is not stopped', async () => {
      const activate = vi.fn()
      const existing = (window as unknown as { __comfyTitlePopup: Record<string, unknown> })
        .__comfyTitlePopup
      ;(window as unknown as { __comfyTitlePopup: Record<string, unknown> }).__comfyTitlePopup = {
        ...existing,
        activate
      }
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: 'a',
        runningInstallationIds: []
      })
      await wrapper.find('.picker-home').trigger('click')
      expect(activate).toHaveBeenCalledWith('new-window')
    })
  })

  describe('user actions', () => {
    it('selects a visible build when the workspace snapshot replaces the list', async () => {
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'personal', name: 'Personal build' })],
        activeInstallationId: null,
        selectedInstallationId: 'personal',
        runningInstallationIds: []
      })
      await wrapper.setProps({
        snapshot: {
          installs: [makeInstall({ id: 'team', name: 'Team build' })],
          activeInstallationId: null,
          selectedInstallationId: 'team',
          runningInstallationIds: [],
          launchingInstallationIds: []
        }
      })
      await flushPromises()
      expect(wrapper.findAll('.picker-row-name').map((row) => row.text())).toEqual(['Team build'])
      expect(bridge.selectedInstallSets.at(-1)).toBe('team')

      await wrapper.setProps({
        snapshot: {
          installs: [],
          activeInstallationId: null,
          selectedInstallationId: null,
          runningInstallationIds: [],
          launchingInstallationIds: []
        }
      })
      await flushPromises()
      expect(wrapper.get('.picker-detail-empty').text()).toBe('Select a build')
      expect(bridge.selectedInstallSets.at(-1)).toBeNull()
    })

    it('filters install rows by search query', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({ id: 'a', name: 'Alpha' }),
          makeInstall({ id: 'b', name: 'Bravo' })
        ],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      const input = wrapper.find('.picker-search input')
      await input.setValue('alph')
      await flushPromises()
      const rows = wrapper.findAll('.picker-row')
      expect(rows.length).toBe(1)
      expect(rows[0]!.text()).toContain('Alpha')
    })

    it('switches visible rows when a non-all filter chip is activated', async () => {
      const wrapper = await mountPicker({
        installs: [
          makeInstall({ id: 'l', name: 'LocalThing', sourceCategory: 'local' }),
          makeInstall({ id: 'r', name: 'RemoteThing', sourceCategory: 'remote' })
        ],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      const chips = wrapper.findAll('.picker-chip')
      const remoteChip = chips.find((c) => c.text() === 'Remote')
      expect(remoteChip).toBeTruthy()
      await remoteChip!.trigger('click')
      const rows = wrapper.findAll('.picker-row')
      expect(rows.length).toBe(1)
      expect(rows[0]!.text()).toContain('RemoteThing')
    })

    it('shows the empty-state hint when no rows match', async () => {
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: null,
        runningInstallationIds: []
      })
      const input = wrapper.find('.picker-search input')
      await input.setValue('zzzz-no-match')
      await flushPromises()
      expect(wrapper.find('.picker-list-empty').exists()).toBe(true)
    })
  })

  describe('settings pane', () => {
    it('auto-selects the first install on an install-less host', async () => {
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' }), makeInstall({ id: 'b', name: 'Beta' })],
        activeInstallationId: null,
        runningInstallationIds: [],
        selectedInstallationId: null
      })
      await flushPromises()
      expect(wrapper.find('.settings-v2-content').exists()).toBe(true)
      expect(bridge.selectedInstallSets).toContain('a')
    })

    it('mounts ComfyUISettingsContent when an install is selected', async () => {
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: 'a',
        runningInstallationIds: []
      })
      expect(wrapper.find('.settings-v2-content').exists()).toBe(true)
    })

    it('dispatches an in-flight background operation only once', async () => {
      const { default: ComfyUISettingsContent } =
        await import('../components/settings/ComfyUISettingsContent.vue')
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: 'a',
        runningInstallationIds: []
      })
      const settings = wrapper.findComponent(ComfyUISettingsContent)
      const operation = {
        installationId: 'a',
        title: 'Update ComfyUI',
        apiCall: vi.fn(),
        actionId: 'update'
      }

      settings.vm.$emit('show-progress', operation)
      settings.vm.$emit('show-progress', operation)
      await flushPromises()

      expect(bridge.backgroundOps).toHaveLength(1)
      expect(bridge.backgroundOps[0]).toMatchObject({ installationId: 'a', actionId: 'update' })
    })
  })

  describe('primary action dispatch', () => {
    it('opens the selected install in a new window when it is not running', async () => {
      const { default: ComfyUISettingsContent } =
        await import('../components/settings/ComfyUISettingsContent.vue')
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: 'a',
        runningInstallationIds: []
      })
      const settings = wrapper.findComponent(ComfyUISettingsContent)
      expect(settings.exists()).toBe(true)
      settings.vm.$emit('primary-action', OPEN_NEW_DECISION)
      await flushPromises()
      expect(bridge.newWindows).toEqual(['a'])
      expect(bridge.picks).toEqual([])
      expect(bridge.restarts).toEqual([])
    })

    it('shows the in-drawer confirm and dispatches restartInstall(confirmed) on accept', async () => {
      const { default: ComfyUISettingsContent } =
        await import('../components/settings/ComfyUISettingsContent.vue')
      const { useDialogs } = await import('../composables/useDialogs')
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha', sourceCategory: 'local' })],
        activeInstallationId: 'a',
        runningInstallationIds: ['a']
      })
      const settings = wrapper.findComponent(ComfyUISettingsContent)
      expect(settings.exists()).toBe(true)
      settings.vm.$emit('primary-action', RESTART_DECISION)
      await flushPromises()
      const dialogs = useDialogs()
      expect(dialogs.state.open).toBe(true)
      expect(dialogs.state.kind).toBe('confirm')
      expect(dialogs.state.confirm.title).toBe('Restart build?')
      expect(bridge.restarts).toEqual([])
      dialogs.confirmPrimary()
      await flushPromises()
      expect(bridge.restarts).toEqual([{ id: 'a', opts: { confirmed: true } }])
      expect(bridge.picks).toEqual([])
    })

    it('does not dispatch restartInstall when the in-drawer confirm is cancelled', async () => {
      const { default: ComfyUISettingsContent } =
        await import('../components/settings/ComfyUISettingsContent.vue')
      const { useDialogs } = await import('../composables/useDialogs')
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha', sourceCategory: 'local' })],
        activeInstallationId: 'a',
        runningInstallationIds: ['a']
      })
      const settings = wrapper.findComponent(ComfyUISettingsContent)
      settings.vm.$emit('primary-action', RESTART_DECISION)
      await flushPromises()
      const dialogs = useDialogs()
      expect(dialogs.state.open).toBe(true)
      dialogs.cancel()
      await flushPromises()
      expect(bridge.restarts).toEqual([])
    })

    it('skips the in-drawer confirm for non-local installs (no local process to kill)', async () => {
      const { default: ComfyUISettingsContent } =
        await import('../components/settings/ComfyUISettingsContent.vue')
      const { useDialogs } = await import('../composables/useDialogs')
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'r', name: 'Remote', sourceCategory: 'remote' })],
        activeInstallationId: 'r',
        runningInstallationIds: ['r']
      })
      const settings = wrapper.findComponent(ComfyUISettingsContent)
      settings.vm.$emit('primary-action', RESTART_DECISION)
      await flushPromises()
      const dialogs = useDialogs()
      expect(dialogs.state.open).toBe(false)
      expect(bridge.restarts).toEqual([{ id: 'r', opts: { confirmed: true } }])
    })

    it('dispatches pickInstall (not restart) for an install running in another window', async () => {
      const { default: ComfyUISettingsContent } =
        await import('../components/settings/ComfyUISettingsContent.vue')
      const wrapper = await mountPicker({
        installs: [
          makeInstall({ id: 'a', name: 'Alpha' }),
          makeInstall({ id: 'b', name: 'Bravo' })
        ],
        activeInstallationId: 'a',
        selectedInstallationId: 'b',
        runningInstallationIds: ['b']
      })
      const settings = wrapper.findComponent(ComfyUISettingsContent)
      expect(settings.exists()).toBe(true)
      settings.vm.$emit('primary-action', FOCUS_DECISION)
      await flushPromises()
      expect(bridge.picks).toEqual(['b'])
      expect(bridge.restarts).toEqual([])
    })
  })

  describe('session-store hydration from snapshot', () => {
    it('hydrates launching ids when only launchingInstallationIds changes', async () => {
      const { useSessionStore } = await import('../stores/sessionStore')
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: null,
        runningInstallationIds: [],
        launchingInstallationIds: []
      })
      const sessionStore = useSessionStore()
      expect(sessionStore.isLaunching('a')).toBe(false)

      await wrapper.setProps({
        snapshot: {
          installs: [makeInstall({ id: 'a', name: 'Alpha' })],
          activeInstallationId: 'a',
          runningInstallationIds: [],
          launchingInstallationIds: ['a'],
          selectedInstallationId: null,
          selectedSettings: null,
          selectedSnapshots: emptySnapshotListPayload
        }
      })
      await flushPromises()
      expect(sessionStore.isLaunching('a')).toBe(true)
    })

    describe('selection epoch gating (#788)', () => {
      it('ignores a stale same-epoch snapshot that would override a local pick', async () => {
        const wrapper = await mountPicker({
          installs: [
            makeInstall({ id: 'a', name: 'Alpha' }),
            makeInstall({ id: 'b', name: 'Bravo' })
          ],
          activeInstallationId: 'a',
          runningInstallationIds: [],
          pickerSelectionEpoch: 1
        })

        const bravoRow = wrapper.findAll('.picker-row').find((c) => c.text().includes('Bravo'))
        await bravoRow!.trigger('click')
        await flushPromises()
        expect(bridge.selectedInstallSets.at(-1)).toBe('b')
        const echoCountAfterClick = bridge.selectedInstallSets.length

        await wrapper.setProps({
          snapshot: {
            installs: [
              makeInstall({ id: 'a', name: 'Alpha' }),
              makeInstall({ id: 'b', name: 'Bravo' })
            ],
            activeInstallationId: 'a',
            runningInstallationIds: [],
            launchingInstallationIds: [],
            selectedInstallationId: 'a',
            pickerSelectionEpoch: 1,
            selectedSettings: null,
            selectedSnapshots: emptySnapshotListPayload
          }
        })
        await flushPromises()

        const stillBravo = wrapper.findAll('.picker-row').find((c) => c.text().includes('Bravo'))
        expect(stillBravo!.classes()).toContain('is-active')
        expect(bridge.selectedInstallSets.length).toBe(echoCountAfterClick)
        expect(bridge.selectedInstallSets.at(-1)).toBe('b')
      })

      it('retargets selection when the epoch advances (main reopened picker)', async () => {
        const wrapper = await mountPicker({
          installs: [
            makeInstall({ id: 'a', name: 'Alpha' }),
            makeInstall({ id: 'b', name: 'Bravo' }),
            makeInstall({ id: 'c', name: 'Charlie' })
          ],
          activeInstallationId: 'a',
          runningInstallationIds: [],
          pickerSelectionEpoch: 1
        })

        const bravoRow = wrapper.findAll('.picker-row').find((c) => c.text().includes('Bravo'))
        await bravoRow!.trigger('click')
        await flushPromises()

        await wrapper.setProps({
          snapshot: {
            installs: [
              makeInstall({ id: 'a', name: 'Alpha' }),
              makeInstall({ id: 'b', name: 'Bravo' }),
              makeInstall({ id: 'c', name: 'Charlie' })
            ],
            activeInstallationId: 'a',
            runningInstallationIds: [],
            launchingInstallationIds: [],
            selectedInstallationId: 'c',
            pickerSelectionEpoch: 2,
            selectedSettings: null,
            selectedSnapshots: emptySnapshotListPayload
          }
        })
        await flushPromises()

        const charlie = wrapper.findAll('.picker-row').find((c) => c.text().includes('Charlie'))
        expect(charlie!.classes()).toContain('is-active')
      })
    })

    it('clears a launching id when it drops out of the snapshot', async () => {
      const { useSessionStore } = await import('../stores/sessionStore')
      const wrapper = await mountPicker({
        installs: [makeInstall({ id: 'a', name: 'Alpha' })],
        activeInstallationId: 'a',
        runningInstallationIds: [],
        launchingInstallationIds: ['a']
      })
      const sessionStore = useSessionStore()
      expect(sessionStore.isLaunching('a')).toBe(true)

      await wrapper.setProps({
        snapshot: {
          installs: [makeInstall({ id: 'a', name: 'Alpha' })],
          activeInstallationId: 'a',
          runningInstallationIds: ['a'],
          launchingInstallationIds: [],
          selectedInstallationId: null,
          selectedSettings: null,
          selectedSnapshots: emptySnapshotListPayload
        }
      })
      await flushPromises()
      expect(sessionStore.isLaunching('a')).toBe(false)
      expect(sessionStore.isRunning('a')).toBe(true)
    })
  })
})
