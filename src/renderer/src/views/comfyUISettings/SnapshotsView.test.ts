import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { TID } from '../../../../shared/testIds'
import SnapshotsView from './SnapshotsView.vue'
import type { SnapshotSummary, SnapshotListData, CopyEvent } from '../../types/ipc'

const { mockConfirm, mockAlert, mockCheckBeforeAction } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockAlert: vi.fn(),
  mockCheckBeforeAction: vi.fn()
}))
vi.mock('../../composables/useDialogs', () => ({
  useDialogs: () => ({
    confirm: mockConfirm,
    alert: mockAlert,
    prompt: vi.fn(),
    actionSheet: vi.fn()
  })
}))
vi.mock('../../composables/useActionGuard', () => ({
  useActionGuard: () => ({ checkBeforeAction: mockCheckBeforeAction })
}))

function makeSnapshot(overrides: Partial<SnapshotSummary> = {}): SnapshotSummary {
  return {
    filename: 'snap-2026-04-01.json',
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    trigger: 'boot',
    label: null,
    comfyuiVersion: 'v0.3.20',
    nodeCount: 10,
    pipPackageCount: 20,
    ...overrides
  }
}

const FIXTURE_SNAPSHOTS: SnapshotSummary[] = [
  makeSnapshot({ filename: 'snap-newest.json', trigger: 'post-update' }),
  makeSnapshot({ filename: 'snap-middle.json', trigger: 'boot' }),
  makeSnapshot({ filename: 'snap-oldest.json', trigger: 'manual', label: 'My save point' })
]

function makeListData(snapshots: SnapshotSummary[] = FIXTURE_SNAPSHOTS): SnapshotListData {
  return {
    snapshots,
    copyEvents: [],
    totalCount: snapshots.length,
    context: { updateChannel: 'stable', pythonVersion: '3.12', variant: 'cpu', variantLabel: 'CPU' }
  }
}

interface ActiveOperation {
  percent: number
  status: string
  done: boolean
  ok: boolean | null
  error: string | null
  actionId: string
  actionData?: Record<string, unknown>
  cancellable?: boolean
}

async function mountView(
  opts: {
    activeOperation?: ActiveOperation | null
    snapshots?: SnapshotSummary[]
  } = {}
): Promise<VueWrapper> {
  const wrapper = mount(SnapshotsView, {
    props: {
      installationId: 'install-A',
      activeOperation: opts.activeOperation ?? null
    },
    global: { plugins: [createPinia()] }
  })
  await flushPromises()
  return wrapper as VueWrapper
}

describe('comfyUISettings/SnapshotsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      getSnapshots: vi.fn().mockResolvedValue(makeListData()),
      getSnapshotDiff: vi.fn().mockResolvedValue(null),
      runAction: vi.fn(),
      exportSnapshot: vi.fn(),
      exportAllSnapshots: vi.fn()
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('idle: renders the Create Snapshot button in the toolbar and no op-card', async () => {
    const w = await mountView()
    expect(w.find(`[data-testid="${TID.snapshotsOpCard}"]`).exists()).toBe(false)
    expect(w.find('.snapshots-rail-node.is-save').exists()).toBe(false)
    const cta = w.find(`[data-testid="${TID.snapshotsSaveCta}"]`)
    expect(cta.text()).toContain('Create Snapshot')
    expect(cta.attributes('disabled')).toBeUndefined()
  })

  it('in-flight: morphs the slot into the op-card with target label + percent + spinner dot', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 42,
        status: 'Loading snapshot…',
        actionData: { file: 'snap-middle.json' },
        cancellable: true
      }
    })

    expect(w.find(`[data-testid="${TID.snapshotsSaveCta}"]`).attributes('disabled')).toBeDefined()
    const card = w.find(`[data-testid="${TID.snapshotsOpCard}"]`)
    expect(card.exists()).toBe(true)

    expect(w.find('.snapshots-rail-label').text()).toContain('Restoring snapshot')

    expect(card.find('.snapshots-op-card-target').text()).toMatch(/from\s+Boot/)

    expect(card.find('.snapshots-op-bar-pct').text()).toContain('42%')

    expect(card.find('.snapshots-op-bar-status').text()).toContain('Loading snapshot')

    const topNode = w.findAll('.snapshots-rail-node.is-save')[0]
    expect(topNode!.find('.snapshots-rail-dot.is-spinning').exists()).toBe(true)

    expect(w.find(`[data-testid="${TID.snapshotsOpCardCancel}"]`).exists()).toBe(true)
  })

  it('in-flight indeterminate: no percent text, fill is .is-indeterminate', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: -1,
        status: 'Stopping…',
        actionData: { file: 'snap-middle.json' }
      }
    })
    expect(w.find('.snapshots-op-bar-pct').exists()).toBe(false)
    expect(w.find('.snapshots-op-bar-fill.is-indeterminate').exists()).toBe(true)
  })

  it('success transition: shows the green card, then auto-dismisses after 1.8s and emits op-dismiss + reload', async () => {
    vi.useFakeTimers()

    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 90,
        status: 'Complete',
        actionData: { file: 'snap-middle.json' }
      }
    })

    const apiGetSnapshots = vi.mocked(
      (window as unknown as { api: { getSnapshots: ReturnType<typeof vi.fn> } }).api.getSnapshots
    )
    apiGetSnapshots.mockClear()

    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: true,
        error: null,
        percent: 100,
        status: 'Complete',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await flushPromises()

    expect(w.find('.snapshots-rail-save-box.is-op-success').exists()).toBe(true)
    expect(w.find('.snapshots-rail-label').text()).toContain('Snapshot restored')
    expect(w.find('.snapshots-op-card.is-success .snapshots-op-card-target').text()).toMatch(
      /Rolled back to/
    )

    expect(w.emitted('op-dismiss')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1800)
    await flushPromises()

    expect(w.emitted('op-dismiss')).toHaveLength(1)
    expect(w.emitted('refresh-all')).toHaveLength(1)
    expect(apiGetSnapshots).toHaveBeenCalledWith('install-A')
  })

  it('success for an imported snapshot says "Applied imported snapshot", never "Rolled back" (an import is an apply, not a rollback)', async () => {
    vi.useFakeTimers()
    const actionData = { restoreToken: '0123456789abcdef0123456789abcdef' }
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 90,
        status: 'Complete',
        actionData
      }
    })
    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: true,
        error: null,
        percent: 100,
        status: 'Complete',
        actionData
      }
    })
    await flushPromises()

    const target = w.find('.snapshots-op-card.is-success .snapshots-op-card-target')
    expect(target.text()).toBe('Applied imported snapshot')
    expect(target.text()).not.toMatch(/Rolled back/)
  })

  it('error: shows red card with message + Retry / Dismiss; clicks emit op-retry / op-dismiss', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 30,
        status: 'Loading snapshot…',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: false,
        error: 'Permission denied',
        percent: 30,
        status: '',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await flushPromises()

    expect(w.find('.snapshots-rail-save-box.is-op-error').exists()).toBe(true)
    expect(w.find(`[data-testid="${TID.pickerOpErrorMessage}"]`).text()).toBe('Permission denied')

    await w.find(`[data-testid="${TID.snapshotsOpCardRetry}"]`).trigger('click')
    expect(w.emitted('op-retry')).toHaveLength(1)
    await nextTick()
    expect(w.find(`[data-testid="${TID.snapshotsSaveCta}"]`).attributes('disabled')).toBeUndefined()
  })

  it('error: Dismiss button emits op-dismiss and clears the card', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 30,
        status: 'Loading snapshot…',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: false,
        error: 'Disk full',
        percent: 30,
        status: '',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await flushPromises()

    await w.find(`[data-testid="${TID.snapshotsOpCardDismiss}"]`).trigger('click')
    expect(w.emitted('op-dismiss')).toHaveLength(1)
  })

  it('cancelled: silently clears the card and dismisses the retained operation', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 30,
        status: 'Loading snapshot…',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: false,
        error: 'Cancelled.',
        percent: 30,
        status: '',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await flushPromises()

    expect(w.find(`[data-testid="${TID.snapshotsOpCard}"]`).exists()).toBe(false)
    expect(w.find(`[data-testid="${TID.snapshotsSaveCta}"]`).attributes('disabled')).toBeUndefined()
    expect(w.emitted('op-dismiss')).toHaveLength(1)
    expect(w.emitted('op-retry')).toBeUndefined()
  })

  it('cancelled import: keeps Retry visible (neutral card, not a red failure) because the staged target is reusable', async () => {
    const actionData = { restoreToken: '0123456789abcdef0123456789abcdef' }
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 30,
        status: 'Loading snapshot…',
        actionData
      }
    })
    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: false,
        error: 'Cancelled.',
        percent: 30,
        status: '',
        actionData
      }
    })
    await flushPromises()

    const card = w.find(`[data-testid="${TID.snapshotsOpCard}"]`)
    expect(card.exists()).toBe(true)
    expect(card.classes()).not.toContain('is-error')
    expect(w.find('.snapshots-rail-save-box.is-op-error').exists()).toBe(false)
    expect(w.emitted('op-dismiss')).toBeUndefined()
    await w.find(`[data-testid="${TID.snapshotsOpCardRetry}"]`).trigger('click')
    expect(w.emitted('op-retry')).toHaveLength(1)
  })

  it('remounts an already-failed import with its Retry action visible', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: false,
        error: 'Package install failed',
        percent: 30,
        status: '',
        actionData: { restoreToken: '0123456789abcdef0123456789abcdef' }
      }
    })

    expect(w.find('.snapshots-rail-save-box.is-op-error').exists()).toBe(true)
    expect(w.find(`[data-testid="${TID.snapshotsOpCardRetry}"]`).exists()).toBe(true)
  })

  it('non-restore op is ignored — update-comfyui does not hijack the snapshots tab', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'update-comfyui',
        done: false,
        ok: null,
        error: null,
        percent: 50,
        status: 'Updating…',
        actionData: { isDowngrade: false }
      }
    })
    expect(w.find(`[data-testid="${TID.snapshotsOpCard}"]`).exists()).toBe(false)
    expect(w.find(`[data-testid="${TID.snapshotsSaveCta}"]`).attributes('disabled')).toBeUndefined()
  })

  it('rows: inline Restore on every row but the newest, a ⋯ trigger on each, all disabled during a restore', async () => {
    const w = await mountView()
    expect(w.find(`[data-testid="${TID.snapshotRowRestore('snap-newest.json')}"]`).exists()).toBe(
      false
    )
    for (const f of ['snap-middle.json', 'snap-oldest.json']) {
      const restore = w.find(`[data-testid="${TID.snapshotRowRestore(f)}"]`)
      expect(restore.exists()).toBe(true)
      expect(restore.attributes('disabled')).toBeUndefined()
    }
    for (const f of ['snap-newest.json', 'snap-middle.json', 'snap-oldest.json']) {
      expect(w.find(`[data-testid="${TID.snapshotRowMore(f)}"]`).exists()).toBe(true)
    }
    expect(w.find('.snapshot-row.is-expanded').exists()).toBe(true)

    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 10,
        status: 'Loading snapshot…',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await flushPromises()
    expect(
      w.find(`[data-testid="${TID.snapshotRowRestore('snap-middle.json')}"]`).attributes('disabled')
    ).toBeDefined()
    expect(
      w.find(`[data-testid="${TID.snapshotRowMore('snap-newest.json')}"]`).attributes('disabled')
    ).toBeDefined()
  })

  it('keeps the rows on screen while Create Snapshot reloads the list', async () => {
    const w = await mountView()
    let finishReload: (data: SnapshotListData) => void = () => {}
    ;(window.api.getSnapshots as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<SnapshotListData>((resolve) => {
        finishReload = resolve
      })
    )

    await w.get(`[data-testid="${TID.snapshotsSaveCta}"]`).trigger('click')
    await flushPromises()

    expect(window.api.runAction).toHaveBeenCalledWith('install-A', 'snapshot-save', {
      label: undefined
    })
    expect(w.find(`[data-testid="${TID.snapshotRow('snap-middle.json')}"]`).exists()).toBe(true)
    expect(w.find('.snapshots-view-status').exists()).toBe(false)

    finishReload(makeListData())
    await flushPromises()
    expect(w.find(`[data-testid="${TID.snapshotRow('snap-middle.json')}"]`).exists()).toBe(true)
  })

  it('keeps Create Snapshot disabled until the restore result card is gone', async () => {
    const w = await mountView({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 50,
        status: 'Restoring',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: true,
        ok: false,
        error: 'pip failed',
        percent: 100,
        status: '',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await flushPromises()
    const cta = (): string | undefined =>
      w.get(`[data-testid="${TID.snapshotsSaveCta}"]`).attributes('disabled')
    expect(cta()).toBeDefined()

    await w.get(`[data-testid="${TID.snapshotsOpCardDismiss}"]`).trigger('click')
    await flushPromises()
    expect(cta()).toBeUndefined()
  })

  describe('row ⋯ menu', () => {
    let w: VueWrapper | null = null
    afterEach(() => {
      w?.unmount()
      w = null
    })

    async function openRowMenu(filename: string): Promise<HTMLElement> {
      w = mount(SnapshotsView, {
        props: { installationId: 'install-A', activeOperation: null },
        global: { plugins: [createPinia()] },
        attachTo: document.body
      }) as VueWrapper
      await flushPromises()
      await w.get(`[data-testid="${TID.snapshotRowMore(filename)}"]`).trigger('keydown', {
        key: 'ArrowDown'
      })
      await flushPromises()
      return document.body.querySelector<HTMLElement>('.snapshot-row-menu')!
    }

    it('Delete asks to confirm, then deletes that snapshot', async () => {
      mockConfirm.mockResolvedValueOnce('primary')
      await openRowMenu('snap-middle.json')

      document.body
        .querySelector<HTMLElement>(`[data-testid="${TID.snapshotRowDelete('snap-middle.json')}"]`)!
        .click()
      await flushPromises()

      expect(mockConfirm).toHaveBeenCalledTimes(1)
      expect(window.api.runAction).toHaveBeenCalledWith('install-A', 'snapshot-delete', {
        file: 'snap-middle.json'
      })
    })

    it('Export exports that snapshot', async () => {
      await openRowMenu('snap-oldest.json')

      document.body
        .querySelector<HTMLElement>(`[data-testid="${TID.snapshotRowExport('snap-oldest.json')}"]`)!
        .click()
      await flushPromises()

      expect(window.api.exportSnapshot).toHaveBeenCalledWith('install-A', 'snap-oldest.json')
    })

    it('Escape closes the menu without reaching a window listener, so a host popup stays open', async () => {
      let reachedWindow = false
      const onWindow = (): void => {
        reachedWindow = true
      }
      const menu = await openRowMenu('snap-middle.json')
      expect(menu).not.toBeNull()
      window.addEventListener('keydown', onWindow)
      try {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await flushPromises()
        expect(document.body.querySelector('.snapshot-row-menu')).toBeNull()
        expect(reachedWindow).toBe(false)
      } finally {
        window.removeEventListener('keydown', onWindow)
      }
    })

    it('closes when the window loses focus', async () => {
      await openRowMenu('snap-middle.json')
      window.dispatchEvent(new Event('blur'))
      await flushPromises()
      expect(document.body.querySelector('.snapshot-row-menu')).toBeNull()
    })
  })

  it('scrolls the top card into view when restore starts', async () => {
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})

    const w = await mountView()
    await w.setProps({
      activeOperation: {
        actionId: 'snapshot-restore',
        done: false,
        ok: null,
        error: null,
        percent: 0,
        status: 'Loading snapshot…',
        actionData: { file: 'snap-middle.json' }
      }
    })
    await flushPromises()
    await nextTick()

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  describe('import flow: kept-local PyTorch disclosure', () => {
    const NOTICE =
      "The snapshot's PyTorch build (2.11.0+xpu) is not available for this machine; the current PyTorch will be kept."

    function installImportApi(confirmResult: Record<string, unknown>): {
      importSnapshotsConfirm: ReturnType<typeof vi.fn>
    } {
      const api = {
        getSnapshots: vi.fn().mockResolvedValue(makeListData()),
        getSnapshotDiff: vi.fn().mockResolvedValue(null),
        runAction: vi.fn(),
        exportSnapshot: vi.fn(),
        exportAllSnapshots: vi.fn(),
        importSnapshotsPreview: vi.fn().mockResolvedValue({
          ok: true,
          preview: {
            snapshots: [
              { label: 'Marker', filename: 'snap.json', createdAt: new Date().toISOString() }
            ]
          }
        }),
        importSnapshotsDiff: vi.fn().mockResolvedValue({
          ok: true,
          diff: { mode: 'current', baseLabel: 'Current state', diff: {}, empty: false }
        }),
        importSnapshotsConfirm: vi.fn().mockResolvedValue(confirmResult)
      }
      ;(window as unknown as { api: Record<string, unknown> }).api = api
      return api
    }

    beforeEach(() => {
      mockConfirm.mockReset()
      mockCheckBeforeAction.mockReset().mockResolvedValue(true)
    })

    it('shows the notice as a second confirm before the restore, then runs it on Restore', async () => {
      installImportApi({ ok: true, imported: 1, restoreToken: 'tok-1', torchStackNotice: NOTICE })
      mockConfirm.mockResolvedValue('primary')

      const w = await mountView()
      await w.find(`[data-testid="${TID.snapshotsImport}"]`).trigger('click')
      await flushPromises()

      expect(mockConfirm).toHaveBeenCalledTimes(2)
      expect(mockConfirm.mock.calls[1]![0]).toMatchObject({
        title: 'Snapshot uses a different PyTorch',
        message: NOTICE
      })
      const runs = w.emitted('run-action')
      expect(runs).toHaveLength(1)
      expect(runs![0]![0]).toMatchObject({
        id: 'snapshot-restore',
        data: { restoreToken: 'tok-1' }
      })
    })

    it('cancelling the notice backs out without running the restore', async () => {
      installImportApi({ ok: true, imported: 1, restoreToken: 'tok-1', torchStackNotice: NOTICE })
      mockConfirm.mockResolvedValueOnce('primary').mockResolvedValueOnce(false)

      const w = await mountView()
      await w.find(`[data-testid="${TID.snapshotsImport}"]`).trigger('click')
      await flushPromises()

      expect(mockConfirm).toHaveBeenCalledTimes(2)
      expect(w.emitted('run-action')).toBeUndefined()
    })

    it('an applicable (or same-stack) snapshot shows no extra dialog and restores directly', async () => {
      installImportApi({ ok: true, imported: 1, restoreToken: 'tok-1', torchStackNotice: null })
      mockConfirm.mockResolvedValue('primary')

      const w = await mountView()
      await w.find(`[data-testid="${TID.snapshotsImport}"]`).trigger('click')
      await flushPromises()

      expect(mockConfirm).toHaveBeenCalledTimes(1)
      expect(w.emitted('run-action')).toHaveLength(1)
    })
  })

  describe('latest detection with copy events (#1007)', () => {
    function makeCopyEvent(overrides: Partial<CopyEvent> = {}): CopyEvent {
      return {
        installationId: 'install-B',
        installationName: 'Copy of A',
        copiedAt: new Date().toISOString(),
        copyReason: 'copy',
        exists: true,
        direction: 'in',
        ...overrides
      }
    }

    async function mountWithCopyEvent(event: CopyEvent): Promise<VueWrapper> {
      ;(window as unknown as { api: Record<string, unknown> }).api = {
        getSnapshots: vi.fn().mockResolvedValue({ ...makeListData(), copyEvents: [event] }),
        getSnapshotDiff: vi.fn().mockResolvedValue(null),
        runAction: vi.fn(),
        exportSnapshot: vi.fn(),
        exportAllSnapshots: vi.fn()
      }
      return mountView()
    }

    it('keeps the Latest badge on the newest snapshot when an incoming copy event sorts first', async () => {
      const w = await mountWithCopyEvent(makeCopyEvent({ direction: 'in' }))

      expect(w.text()).toContain('Copied from Copy of A')

      const badges = w.findAll('.snapshot-row-latest')
      expect(badges).toHaveLength(1)
      const newestRow = w.find(`[data-testid="${TID.snapshotRow('snap-newest.json')}"]`)
      expect(newestRow.find('.snapshot-row-latest').exists()).toBe(true)

      expect(w.find(`[data-testid="${TID.snapshotRowRestore('snap-newest.json')}"]`).exists()).toBe(
        false
      )
    })

    it('keeps the Latest badge on the newest snapshot for an outgoing copy event', async () => {
      const w = await mountWithCopyEvent(makeCopyEvent({ direction: 'out' }))

      expect(w.text()).toContain('Copied to Copy of A')
      expect(w.findAll('.snapshot-row-latest')).toHaveLength(1)
      expect(w.find(`[data-testid="${TID.snapshotRowRestore('snap-newest.json')}"]`).exists()).toBe(
        false
      )
    })

    it('header "Latest:" stat reflects the newest snapshot, not the copy event time', async () => {
      const w = await mountWithCopyEvent(makeCopyEvent({ direction: 'in' }))

      const latest = w.find('.snapshots-view-latest')
      expect(latest.text()).toContain('Latest:')
      expect(latest.text()).toContain('1h ago')
    })
  })
})
