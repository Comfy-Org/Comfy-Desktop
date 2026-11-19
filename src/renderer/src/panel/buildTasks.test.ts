import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import PanelApp from './PanelApp.vue'
import { __resetLauncherPrefsForTest } from '../composables/useLauncherPrefs'
import { useModal } from '../composables/useModal'
import { useOverlay } from '../composables/useOverlay'
import { en } from '../lib/i18nMessages'
import { TID } from '../../../shared/testIds'
import { progressOpKindForActionId } from '../lib/progressOpKind'
import type {
  ActionResult,
  DetailSection,
  Installation,
  ProgressData,
  ShowProgressOpts
} from '../types/ipc'

const BUILD: Installation = {
  id: 'video-lab',
  name: 'Video Lab',
  sourceId: 'standalone',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed',
  version: 'v0.38.0',
  installPath: '/Users/ada/ComfyUI/video-lab'
}

const OTHER_BUILD: Installation = {
  ...BUILD,
  id: 'sketchbook',
  name: 'Sketchbook',
  installPath: '/Users/ada/ComfyUI/sketchbook',
  statusTag: undefined
}

const COPY: Installation = {
  ...BUILD,
  id: 'video-lab-copy',
  name: 'Video Lab copy',
  installPath: '/Users/ada/ComfyUI/video-lab-copy'
}

const SECTIONS: DetailSection[] = [{ tab: 'status', title: 'Details', fields: [] }]

interface RunCall {
  actionId: string
  data?: Record<string, unknown>
  finish: (result: ActionResult) => void
}

interface Desktop {
  installations: Installation[]
  running: Set<string>
  runs: RunCall[]
  cancelled: string[]
  startFromPicker: (request: {
    installationId?: string
    actionId: string
    title: string
    opKind?: ShowProgressOpts['opKind']
    actionData?: Record<string, unknown>
    cancellable?: boolean
  }) => Promise<void>
  reportProgress: (data: ProgressData) => Promise<void>
  askToClose: () => Promise<{ cleared?: boolean; defer?: true }>
  portKills: Array<{ port: number; resolve: (result: { ok: boolean }) => void }>
}

function openDesktop(installations: Installation[]): Desktop {
  const panelListeners = new Set<Parameters<typeof window.api.onPanelSwitch>[0]>()
  const overlayListeners = new Set<Parameters<typeof window.api.onPanelTriggerOverlay>[0]>()
  const progressListeners = new Set<(data: ProgressData) => void>()
  const closeListeners = new Set<(request: { requestId: string }) => void>()
  const closeAnswers = new Map<string, (answer: { cleared?: boolean; defer?: true }) => void>()
  const stoppedListeners = new Set<(data: { installationId: string }) => void>()
  const desktop: Desktop = {
    installations,
    running: new Set(),
    runs: [],
    cancelled: [],
    portKills: [],
    askToClose() {
      const requestId = `close-${closeAnswers.size + 1}`
      const answer = new Promise<{ cleared?: boolean; defer?: true }>((resolve) =>
        closeAnswers.set(requestId, resolve)
      )
      closeListeners.forEach((listener) => listener({ requestId }))
      return answer
    },
    async startFromPicker(request) {
      panelListeners.forEach((listener) => listener({ panel: 'progress' }))
      overlayListeners.forEach((listener) =>
        listener({ kind: 'picker-show-progress', installationId: BUILD.id, ...request })
      )
      await flushPromises()
    },
    async reportProgress(data) {
      progressListeners.forEach((listener) => listener(data))
      await flushPromises()
    }
  }
  const subscribe =
    <T>(listeners: Set<T>) =>
    (listener: T) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  const answered: Record<string, unknown> = {
    platform: 'darwin',
    comfybuilder: {
      getAuthStatus: async () => ({ signedIn: false }),
      onAuthChanged: () => () => {},
      listWorkspaces: async () => [],
      listBuilds: async () => []
    },
    getLocale: async () => 'en',
    getLocaleMessages: async () => en,
    getSetting: async (key: string) => (key === 'firstUseCompleted' ? true : undefined),
    getInstallations: async () => desktop.installations,
    getRunningInstances: async () =>
      [...desktop.running].map((installationId) => ({
        installationId,
        installationName: installationId,
        mode: 'local'
      })),
    onInstanceStopped: subscribe(stoppedListeners),
    stopComfyUI: async (id: string) => {
      desktop.running.delete(id)
      stoppedListeners.forEach((listener) => listener({ installationId: id }))
    },
    getListActions: async () => [],
    getFieldOptions: async () => [],
    listHomeWorkflows: async () => [],
    listApps: async () => [],
    getAppsEnabled: async () => false,
    getAppUpdateState: async () => ({ kind: null, version: null, autoUpdate: true }),
    getCloudFreeRunsEnabled: async () => false,
    getCloudUserTier: async () => 'unknown',
    refreshCreditBalance: async () => ({ status: 'signed_out' }),
    getDetailSections: async () => SECTIONS,
    getDiskSpace: async () => null,
    getInstallationSize: async () => ({ sizeBytes: 0 }),
    getFirstUseState: async () => ({ skipPick: false, hasLegacyDesktop: false }),
    closeCurrentPanel: () => panelListeners.forEach((listener) => listener({ panel: 'chooser' })),
    onPanelSwitch: subscribe(panelListeners),
    onPanelTriggerOverlay: subscribe(overlayListeners),
    onInstallProgress: subscribe(progressListeners),
    runAction: (_id: string, actionId: string, data?: Record<string, unknown>) =>
      new Promise<ActionResult>((finish) => {
        desktop.runs.push({ actionId, data, finish })
      }),
    cancelOperation: async (id: string) => {
      desktop.cancelled.push(id)
    },
    killPortProcess: (port: number) =>
      new Promise<{ ok: boolean }>((resolve) => {
        desktop.portKills.push({ port, resolve })
      }),
    onCloseRequest: subscribe(closeListeners),
    ackCloseRequest: () => {},
    respondCloseRequest: ({
      requestId,
      ...answer
    }: {
      requestId: string
      cleared?: boolean
      defer?: true
    }) => closeAnswers.get(requestId)?.(answer)
  }
  ;(window as unknown as { api: unknown }).api = new Proxy(answered, {
    get(known, key) {
      if (typeof key !== 'string') return undefined
      if (key in known) return known[key]
      if (key.startsWith('on')) return () => () => {}
      return async () => undefined
    }
  })
  return desktop
}

function onPage<T extends Element = HTMLElement>(testId: string): T | null {
  return document.body.querySelector<T>(`[data-testid="${testId}"]`)
}

async function press(testId: string): Promise<void> {
  const control = onPage(testId)
  expect(control, `${testId} is on the page`).not.toBeNull()
  control!.click()
  await flushPromises()
}

async function openBuildsList(): Promise<void> {
  mount(PanelApp, { attachTo: document.body, global: { plugins: [createPinia()] } })
  await flushPromises()
  await press('app-sidebar-chooser')
  await vi.waitFor(() => expect(onPage(TID.dashboardTile(BUILD.id))).not.toBeNull())
}

async function chooseOnTileMenu(item: string): Promise<void> {
  await press(TID.dashboardTileKebab(BUILD.id))
  await vi.waitFor(() => expect(onPage('build-menu')).not.toBeNull())
  await press(`build-menu-${item}`)
}

function fullScreenProgress(): Element | null {
  return document.body.querySelector('.brand-progress')
}

function buildTile(): HTMLElement | null {
  return onPage(TID.dashboardTile(BUILD.id))
}

function buildPage(): HTMLElement | null {
  return onPage('build-details')
}

function progressBarIn(scope: Element | null): string | null {
  return scope?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null
}

async function lastRun(): Promise<RunCall> {
  await vi.waitFor(() => expect(desktop.runs.length).toBeGreaterThan(0))
  return desktop.runs.at(-1)!
}

let desktop: Desktop

beforeEach(() => {
  useModal().dismiss()
  setActivePinia(createPinia())
  __resetLauncherPrefsForTest()
  useOverlay().current.value = null
  window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
  desktop = openDesktop([BUILD])
})

describe('a task on a build runs on its tile, never on the full-screen page', () => {
  it.each([
    { actionId: 'git-pull', title: 'Pulling changes - Video Lab', task: 'Pulling changes' },
    {
      actionId: 'change-pytorch',
      title: 'Changing PyTorch - Video Lab',
      task: 'Changing PyTorch',
      actionData: { stackId: 'cu128' }
    },
    {
      actionId: 'restore-snapshot',
      title: 'Restoring snapshot - Video Lab',
      task: 'Restoring snapshot',
      actionData: { file: 'snapshot.json' }
    },
    { actionId: 'migrate-to-standalone', title: 'Migrating - Video Lab', task: 'Migrating' }
  ])('$actionId shows "$task" and its percent on the tile', async (request) => {
    await openBuildsList()

    await desktop.startFromPicker({
      ...request,
      opKind: progressOpKindForActionId(request.actionId),
      cancellable: true
    })
    const run = await lastRun()
    expect(run.actionId).toBe(request.actionId)
    expect(run.data).toEqual(request.actionData)

    expect(fullScreenProgress()).toBeNull()
    expect(onPage('app-sidebar')).not.toBeNull()
    expect(buildTile()!.textContent).toContain(request.task)

    await desktop.reportProgress({ installationId: BUILD.id, phase: 'work', percent: 40 })
    expect(buildTile()!.textContent).toContain(`${request.task} · 40%`)
    expect(progressBarIn(buildTile())).toBe('40')

    run.finish({ ok: true })
    await flushPromises()
    expect(buildTile()!.textContent).not.toContain(request.task)
    expect(fullScreenProgress()).toBeNull()
  })

  it('shows the task on the build page in place of its settings', async () => {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'git-pull',
      title: 'Pulling changes - Video Lab',
      opKind: 'generic'
    })
    const run = await lastRun()

    await chooseOnTileMenu('manage')
    await vi.waitFor(() => expect(buildPage()).not.toBeNull())

    expect(onPage('home-build-working')).not.toBeNull()
    expect(buildPage()!.querySelector('.build-details-status')!.textContent).toContain(
      'Pulling changes'
    )
    expect(onPage(TID.pickerMoreTrigger)).toBeNull()

    run.finish({ ok: true })
    await flushPromises()
    expect(onPage('home-build-working')).toBeNull()
    await vi.waitFor(() => expect(onPage(TID.pickerMoreTrigger)).not.toBeNull())
  })

  it('copies on the original tile, then lands on the new build page', async () => {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'copy',
      title: 'Copying installation - Video Lab',
      opKind: 'generic',
      actionData: { name: COPY.name },
      cancellable: true
    })
    const run = await lastRun()
    await desktop.reportProgress({ installationId: BUILD.id, phase: 'copy', percent: 25 })

    expect(fullScreenProgress()).toBeNull()
    expect(buildTile()!.textContent).toContain('Copying installation · 25%')

    desktop.installations = [BUILD, COPY]
    run.finish({ ok: true, navigate: 'list', newInstallationId: COPY.id })
    await flushPromises()

    await vi.waitFor(() => expect(buildPage()).not.toBeNull())
    await vi.waitFor(() =>
      expect(buildPage()!.querySelector('h1')!.textContent).toContain(COPY.name)
    )
    expect(fullScreenProgress()).toBeNull()
  })

  it('still lands on the new build when the copy works on Try again', async () => {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'copy',
      title: 'Copying installation - Video Lab',
      opKind: 'generic',
      actionData: { name: COPY.name }
    })
    ;(await lastRun()).finish({ ok: false, message: 'disk full' })
    await flushPromises()
    await chooseOnTileMenu('manage')
    await vi.waitFor(() => expect(onPage('build-operation-retry')).not.toBeNull())

    await press('build-operation-retry')
    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))
    expect(desktop.runs[1], 'Try again replays the same copy').toMatchObject({
      actionId: 'copy',
      data: { name: COPY.name }
    })
    desktop.installations = [BUILD, COPY]
    desktop.runs[1]!.finish({ ok: true, navigate: 'list', newInstallationId: COPY.id })
    await flushPromises()

    await vi.waitFor(() =>
      expect(buildPage()?.querySelector('h1')?.textContent).toContain(COPY.name)
    )
  })

  it('asks before stopping a task from the tile menu', async () => {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'copy',
      title: 'Copying installation - Video Lab',
      opKind: 'generic',
      actionData: { name: COPY.name },
      cancellable: true
    })
    await lastRun()

    await chooseOnTileMenu('cancel')
    await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
    expect(document.body.textContent).toContain('Copying installation stops for Video Lab')
    await press(TID.baseAlertAction)

    expect(desktop.cancelled).toEqual([BUILD.id])
  })

  it('offers no Cancel for a task that cannot stop', async () => {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'git-pull',
      title: 'Pulling changes - Video Lab',
      opKind: 'generic'
    })
    await lastRun()

    await press(TID.dashboardTileKebab(BUILD.id))
    await vi.waitFor(() => expect(onPage('build-menu')).not.toBeNull())
    expect(onPage('build-menu-view-logs')).not.toBeNull()
    expect(onPage('build-menu-cancel')).toBeNull()
  })

  it('a failed task says so on the build page, and Try again runs it again', async () => {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'git-pull',
      title: 'Pulling changes - Video Lab',
      opKind: 'generic'
    })
    ;(await lastRun()).finish({ ok: false, message: 'remote hung up' })
    await flushPromises()

    expect(fullScreenProgress()).toBeNull()
    expect(buildTile()!.querySelector('.chooser-tile-error-badge')).not.toBeNull()

    await chooseOnTileMenu('manage')
    await vi.waitFor(() => expect(onPage('build-operation-failed')).not.toBeNull())
    expect(onPage('build-operation-failed')!.textContent).toContain("Pulling changes didn't finish")
    expect(onPage('build-operation-failed-reason')!.textContent).toContain('remote hung up')

    await press('build-operation-retry')
    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))
    expect(desktop.runs[1]!.actionId).toBe('git-pull')
    expect(onPage('build-operation-failed')).toBeNull()
    expect(onPage('home-build-working')).not.toBeNull()
  })
})

describe('a port conflict when a build starts', () => {
  async function startIntoConflict(): Promise<void> {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'launch',
      title: 'Starting ComfyUI - Video Lab',
      opKind: 'launch',
      cancellable: true
    })
    ;(await lastRun()).finish({
      ok: false,
      message: 'Port 8188 is already in use by python.',
      portConflict: { port: 8188, nextPort: 8189, isComfy: true }
    })
    await flushPromises()
    await vi.waitFor(() => expect(onPage(TID.progressPortConflictUsePort)).not.toBeNull())
  }

  it('asks in a dialog over the builds list, not on the full-screen page', async () => {
    await startIntoConflict()

    expect(fullScreenProgress()).toBeNull()
    expect(buildTile()!.checkVisibility()).toBe(true)
    expect(document.body.textContent).toContain('Port already in use')
    expect(document.body.textContent).toContain('Port 8188 is already in use by python.')
    expect(onPage(TID.progressPortConflictKill)).not.toBeNull()
  })

  it('puts its choices in the dialog footer, next to Cancel', async () => {
    await startIntoConflict()

    const footer = document.querySelector('.base-alert-footer')
    expect(footer).not.toBeNull()
    expect(footer!.contains(onPage(TID.progressPortConflictUsePort))).toBe(true)
    expect(footer!.contains(onPage(TID.progressPortConflictKill))).toBe(true)
    expect(footer!.contains(onPage(TID.baseAlertCancel))).toBe(true)
    const boxes = [
      TID.baseAlertCancel,
      TID.progressPortConflictKill,
      TID.progressPortConflictUsePort
    ].map((id) => {
      const button = onPage(id)!
      expect(button.checkVisibility({ visibilityProperty: true }), `${id} is visible`).toBe(true)
      return button.getBoundingClientRect()
    })
    for (const box of boxes) {
      expect(box.width, 'each footer button is rendered').toBeGreaterThan(0)
      expect(box.height, 'each footer button is rendered').toBeGreaterThan(0)
    }
    const tops = boxes.map((box) => Math.round(box.top))
    const byLeft = [...boxes].sort((a, b) => a.left - b.left)
    byLeft.slice(1).forEach((box, i) => {
      expect(box.left, 'the buttons do not overlap').toBeGreaterThanOrEqual(byLeft[i]!.right)
    })
    expect(new Set(tops).size, 'the three buttons sit on one row').toBe(1)
  })

  it('starts again on the next free port', async () => {
    await startIntoConflict()

    await press(TID.progressPortConflictUsePort)

    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))
    expect(desktop.runs[1]).toMatchObject({ actionId: 'launch', data: { portOverride: 8189 } })
    expect(fullScreenProgress()).toBeNull()
  })

  it('goes back to the choices when the stop is not confirmed', async () => {
    await startIntoConflict()

    await press(TID.progressPortConflictKill)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Stop Existing Process'))
    await press(TID.baseAlertCancel)

    await vi.waitFor(() => expect(onPage(TID.progressPortConflictUsePort)).not.toBeNull())
    expect(desktop.portKills).toHaveLength(0)
  })

  it('says the build did not start when another task took it during the stop', async () => {
    await startIntoConflict()
    await press(TID.progressPortConflictKill)
    await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
    await press(TID.baseAlertAction)
    await vi.waitFor(() => expect(desktop.portKills).toHaveLength(1))
    await desktop.startFromPicker({
      actionId: 'update-comfyui',
      title: 'Updating ComfyUI - Video Lab',
      opKind: 'update',
      cancellable: true
    })
    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))

    desktop.portKills[0]!.resolve({ ok: true })
    await flushPromises()

    await vi.waitFor(() => expect(document.body.textContent).toContain("Video Lab didn't start"))
    expect(desktop.runs.map((run) => run.actionId)).toEqual(['launch', 'update-comfyui'])
  })

  it('keeps the next port on offer when stopping the other process fails', async () => {
    await startIntoConflict()

    await press(TID.progressPortConflictKill)
    await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
    await press(TID.baseAlertAction)
    await vi.waitFor(() => expect(desktop.portKills).toHaveLength(1))
    expect(desktop.portKills[0]!.port, 'the stop targets the busy port').toBe(8188)
    desktop.portKills[0]!.resolve({ ok: false })
    await flushPromises()

    await vi.waitFor(() => expect(onPage(TID.progressPortConflictUsePort)).not.toBeNull())
    expect(
      onPage(TID.progressPortConflictKill),
      'no second stop of a listener that may have changed'
    ).toBeNull()
    expect(document.body.textContent).toContain('8188')
    await press(TID.progressPortConflictUsePort)
    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))
    expect(desktop.runs[1]).toMatchObject({ actionId: 'launch', data: { portOverride: 8189 } })
  })
})

describe('a port conflict when a build restarts after an update', () => {
  it('asks about the port, and only starts the build again', async () => {
    desktop.running.add(BUILD.id)
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'update-comfyui',
      title: 'Updating ComfyUI - Video Lab',
      opKind: 'update',
      cancellable: true
    })
    ;(await lastRun()).finish({ ok: true })
    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))
    expect(desktop.runs[1]!.actionId).toBe('launch')
    desktop.runs[1]!.finish({
      ok: false,
      message: 'Port 8188 is already in use by python.',
      portConflict: { port: 8188, nextPort: 8189, isComfy: true }
    })
    await flushPromises()

    await vi.waitFor(() => expect(onPage(TID.progressPortConflictUsePort)).not.toBeNull())
    await press(TID.progressPortConflictUsePort)

    await vi.waitFor(() => expect(desktop.runs).toHaveLength(3))
    expect(desktop.runs[2]).toMatchObject({ actionId: 'launch', data: { portOverride: 8189 } })
  })
})

describe('closing the Desktop window while a task runs', () => {
  async function startPull(): Promise<void> {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'git-pull',
      title: 'Pulling changes - Video Lab',
      opKind: 'generic',
      cancellable: true
    })
    await lastRun()
  }

  it('lets the window close at once when nothing is running', async () => {
    await openBuildsList()

    await expect(desktop.askToClose()).resolves.toEqual({ defer: true })
  })

  it('keeps the window and the task when the user does not stop it', async () => {
    await startPull()

    const answer = desktop.askToClose()
    await vi.waitFor(() => expect(onPage(TID.baseAlertCancel)).not.toBeNull())
    expect(document.body.textContent).toContain('Stop now?')
    await press(TID.baseAlertCancel)

    await expect(answer).resolves.toEqual({ cleared: false })
    expect(desktop.cancelled).toEqual([])
    expect(buildTile()!.textContent).toContain('Pulling changes')
  })

  it('waits for a task that cannot be stopped, and keeps the window', async () => {
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'git-pull',
      title: 'Pulling changes - Video Lab',
      opKind: 'generic',
      cancellable: false
    })
    await lastRun()

    const answer = desktop.askToClose()
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("This task can't be stopped")
    )
    expect(onPage(TID.baseAlertCancel), 'no Stop is offered').toBeNull()
    await press(TID.baseAlertAction)

    await expect(answer).resolves.toEqual({ cleared: false })
    expect(desktop.cancelled).toEqual([])
  })

  it('does not stop a new task when the user agrees to stop one that already ended', async () => {
    await startPull()
    const answer = desktop.askToClose()
    await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
    ;(await lastRun()).finish({ ok: true })
    await flushPromises()
    await desktop.startFromPicker({
      actionId: 'git-pull',
      title: 'Pulling changes - Video Lab',
      opKind: 'generic',
      cancellable: true
    })
    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))

    await press(TID.baseAlertAction)

    await expect(answer).resolves.toEqual({ cleared: false })
    expect(desktop.cancelled).toEqual([])
    expect(buildTile()!.textContent).toContain('Pulling changes')
  })

  it('shows a port question only after the stop question is answered', async () => {
    desktop.installations = [BUILD, COPY]
    await openBuildsList()
    await desktop.startFromPicker({
      actionId: 'launch',
      title: 'Starting ComfyUI - Video Lab',
      opKind: 'launch',
      cancellable: true
    })
    const launch = await lastRun()
    await desktop.startFromPicker({
      installationId: COPY.id,
      actionId: 'git-pull',
      title: 'Pulling changes - Video Lab copy',
      opKind: 'generic',
      cancellable: true
    })
    await vi.waitFor(() => expect(desktop.runs).toHaveLength(2))
    const answer = desktop.askToClose()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Stop now?'))

    launch.finish({
      ok: false,
      message: 'Port 8188 is already in use by python.',
      portConflict: { port: 8188, nextPort: 8189, isComfy: true }
    })
    await flushPromises()
    expect(onPage(TID.progressPortConflictUsePort), 'the stop question stays up').toBeNull()
    await press(TID.baseAlertCancel)

    await expect(answer).resolves.toEqual({ cleared: false })
    await vi.waitFor(() => expect(onPage(TID.progressPortConflictUsePort)).not.toBeNull())
  })

  it('stops the task and lets the window close once the user agrees', async () => {
    await startPull()

    const answer = desktop.askToClose()
    await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
    await press(TID.baseAlertAction)

    await expect(answer).resolves.toEqual({ cleared: true })
    expect(desktop.cancelled).toEqual([BUILD.id])
  })
})
