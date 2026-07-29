import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

// The import flow drives promise-based modals and the busy guard; stub both
// so tests can script the user's choices without a modal host/session store.
const { mockModalConfirm, mockModalAlert, mockCheckBeforeAction } = vi.hoisted(() => ({
  mockModalConfirm: vi.fn(),
  mockModalAlert: vi.fn(),
  mockCheckBeforeAction: vi.fn(),
}))
vi.mock('../composables/useModal', () => ({
  useModal: () => ({
    confirm: mockModalConfirm,
    alert: mockModalAlert,
    prompt: vi.fn(),
    confirmWithOptions: vi.fn(),
    updateConfirm: vi.fn(),
  }),
}))
vi.mock('../composables/useActionGuard', () => ({
  useActionGuard: () => ({ checkBeforeAction: mockCheckBeforeAction }),
}))

import SnapshotTab from './SnapshotTab.vue'
import ImportPreviewModal from './ImportPreviewModal.vue'
import RestoreModal from './RestoreModal.vue'

const messages = {
  en: {
    snapshots: {
      importSnapshots: 'Import',
      importTorchNoticeTitle: 'Snapshot uses a different PyTorch',
      createSnapshot: 'Create Snapshot',
      exportAllSnapshots: 'Export All',
      empty: 'No snapshots yet.',
    },
    standalone: {
      snapshotRestore: 'Restore',
      snapshotRestoringTitle: 'Restoring snapshot',
    },
    common: { loading: 'Loading' },
  },
} as const

function makeListData() {
  return {
    snapshots: [
      {
        filename: 'snap-1.json',
        createdAt: new Date().toISOString(),
        trigger: 'manual',
        label: null,
        comfyuiVersion: 'v0.3.20',
        nodeCount: 0,
        pipPackageCount: 0,
      },
    ],
    copyEvents: [],
    totalCount: 1,
    context: { updateChannel: 'stable', pythonVersion: '3.12', variant: 'cpu', variantLabel: 'CPU' },
  }
}

function installApi(confirmResult: Record<string, unknown>): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    getSnapshots: vi.fn().mockResolvedValue(makeListData()),
    importSnapshotsPreview: vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        snapshots: [{ label: 'Marker', filename: 'snap.json', createdAt: new Date().toISOString() }],
      },
    }),
    importSnapshotsDiff: vi.fn().mockResolvedValue({
      ok: true,
      diff: {
        mode: 'current',
        baseLabel: 'Current state',
        diff: {
          comfyuiChanged: false,
          updateChannelChanged: false,
          nodesAdded: [],
          nodesRemoved: [],
          nodesChanged: [],
          pipsAdded: [],
          pipsRemoved: [],
          pipsChanged: [],
        },
        empty: true,
      },
    }),
    importSnapshotsConfirm: vi.fn().mockResolvedValue(confirmResult),
  }
}

async function mountTab(): Promise<VueWrapper> {
  const wrapper = mount(SnapshotTab, {
    props: { installationId: 'install-A' },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { SnapshotInspector: true, RestoreModal: true, ImportPreviewModal: true },
    },
  })
  await flushPromises()
  return wrapper as VueWrapper
}

/** Click Import, accept the preview, and confirm the restore diff modal. */
async function driveImportToRestoreConfirm(w: VueWrapper): Promise<void> {
  await w.findAll('.snapshot-header-btn')[0]!.trigger('click')
  await flushPromises()
  w.findComponent(ImportPreviewModal).vm.$emit('confirm')
  await flushPromises()
  w.findComponent(RestoreModal).vm.$emit('confirm')
  await flushPromises()
}

// A cross-vendor envelope's PyTorch stack can't be applied here; the
// compatible restore keeps the local stack. That substitution must be
// disclosed BEFORE the restore runs, and the user must be able to back out.
describe('SnapshotTab import flow: kept-local PyTorch disclosure', () => {
  const NOTICE = "The snapshot's PyTorch build (2.11.0+xpu) is not available for this machine; the current PyTorch will be kept."

  beforeEach(() => {
    mockModalConfirm.mockReset()
    mockModalAlert.mockReset()
    mockCheckBeforeAction.mockReset().mockResolvedValue(true)
  })

  it('shows the notice as a confirm before the restore, then runs it on Restore', async () => {
    installApi({ ok: true, imported: 1, restoreToken: 'tok-1', torchStackNotice: NOTICE })
    mockModalConfirm.mockResolvedValue(true)

    const w = await mountTab()
    await driveImportToRestoreConfirm(w)

    expect(mockModalConfirm).toHaveBeenCalledTimes(1)
    expect(mockModalConfirm.mock.calls[0]![0]).toMatchObject({
      title: 'Snapshot uses a different PyTorch',
      message: NOTICE,
    })
    const runs = w.emitted('run-action')
    expect(runs).toHaveLength(1)
    expect(runs![0]![0]).toMatchObject({ id: 'snapshot-restore', data: { restoreToken: 'tok-1' } })
  })

  it('cancelling the notice backs out without running the restore', async () => {
    installApi({ ok: true, imported: 1, restoreToken: 'tok-1', torchStackNotice: NOTICE })
    mockModalConfirm.mockResolvedValue(false)

    const w = await mountTab()
    await driveImportToRestoreConfirm(w)

    expect(mockModalConfirm).toHaveBeenCalledTimes(1)
    expect(w.emitted('run-action')).toBeUndefined()
  })

  it('an applicable (or same-stack) snapshot shows no extra dialog and restores directly', async () => {
    installApi({ ok: true, imported: 1, restoreToken: 'tok-1', torchStackNotice: null })

    const w = await mountTab()
    await driveImportToRestoreConfirm(w)

    expect(mockModalConfirm).not.toHaveBeenCalled()
    expect(w.emitted('run-action')).toHaveLength(1)
  })
})
