import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('vue-i18n', async (importOriginal) =>
  (await import('../lib/vueI18nWithAppMessages')).vueI18nWithAppMessages(importOriginal)
)

const modalSpies = vi.hoisted(() => ({
  confirm: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  confirmWithOptions: vi.fn(),
  alert: vi.fn()
}))
const dialogsSpies = vi.hoisted(() => ({
  confirm: vi.fn(),
  prompt: vi.fn(),
  actionSheet: vi.fn(),
  alert: vi.fn()
}))
const actionGuardSpies = vi.hoisted(() => ({
  checkBeforeAction: vi.fn()
}))

vi.mock('./useModal', () => ({ useModal: () => modalSpies }))
vi.mock('./useDialogs', () => ({ useDialogs: () => dialogsSpies }))
vi.mock('./useActionGuard', () => ({ useActionGuard: () => actionGuardSpies }))
vi.mock('./useMigrateAction', () => ({
  useMigrateAction: () => ({ confirmMigration: vi.fn() })
}))
vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toErrorBucket: () => 'other'
}))

import { useQuickUpdate } from './useQuickUpdate'
import type { ActionDef, DetailSection, Installation, ShowProgressOpts } from '../types/ipc'

const inst = {
  id: 'inst-1',
  name: 'ComfyUI',
  sourceId: 'standalone',
  sourceCategory: 'local',
  status: 'installed',
  installPath: '/tmp/inst-1'
} as Installation

function updateAction(channel: string, overrides: Partial<ActionDef> = {}): ActionDef {
  return {
    id: 'update-comfyui',
    label: 'Update Now',
    style: 'primary',
    enabled: true,
    showProgress: true,
    progressTitle: `Updating ${channel}`,
    data: { channel },
    confirm: { title: 'Update ComfyUI', message: `Update on ${channel}?` },
    ...overrides
  } as ActionDef
}

function channelSections(current: string, actions: Record<string, ActionDef[]>): DetailSection[] {
  return [
    {
      tab: 'update',
      title: 'Update Channel',
      fields: [
        {
          id: 'updateChannel',
          label: 'Channel',
          editType: 'channel-cards',
          value: current,
          options: Object.entries(actions).map(([value, nested]) => ({
            value,
            label: value,
            data: { actions: nested }
          }))
        }
      ]
    } as unknown as DetailSection
  ]
}

const api = {
  getDetailSections: vi.fn(),
  runAction: vi.fn().mockResolvedValue({ ok: true }),
  getDiskSpace: vi.fn().mockResolvedValue({ free: Number.MAX_SAFE_INTEGER })
}

function mountQuickUpdate() {
  const onShowProgress = vi.fn<(opts: ShowProgressOpts) => void>()
  const onUnavailable = vi.fn<(inst: Installation) => void>()
  const scope = effectScope()
  const { runQuickUpdate } = scope.run(() => useQuickUpdate({ onShowProgress, onUnavailable }))!
  return { runQuickUpdate, onShowProgress, onUnavailable, scope }
}

beforeEach(() => {
  setActivePinia(createTestingPinia({ stubActions: false }))
  vi.clearAllMocks()
  ;(window as unknown as { api: typeof api }).api = api
  actionGuardSpies.checkBeforeAction.mockResolvedValue(true)
})

describe('useQuickUpdate', () => {
  it('confirms the current channel update in place and starts progress that returns to the Builds list', async () => {
    api.getDetailSections.mockResolvedValue(
      channelSections('stable', {
        latest: [updateAction('latest')],
        stable: [updateAction('stable')]
      })
    )
    dialogsSpies.confirm.mockResolvedValue('primary')
    const { runQuickUpdate, onShowProgress, onUnavailable, scope } = mountQuickUpdate()

    await runQuickUpdate(inst)

    expect(dialogsSpies.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Update ComfyUI', message: 'Update on stable?' })
    )
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(onShowProgress).toHaveBeenCalledTimes(1)
    const progress = onShowProgress.mock.calls[0]![0]
    expect(progress).toMatchObject({
      installationId: 'inst-1',
      title: 'Updating stable — ComfyUI',
      returnTo: 'list',
      actionId: 'update-comfyui',
      actionData: { channel: 'stable' }
    })

    await progress.apiCall()
    expect(api.runAction).toHaveBeenCalledWith('inst-1', 'update-comfyui', { channel: 'stable' })
    scope.stop()
  })

  it('starts nothing when the confirm is cancelled', async () => {
    api.getDetailSections.mockResolvedValue(
      channelSections('stable', { stable: [updateAction('stable')] })
    )
    dialogsSpies.confirm.mockResolvedValue(false)
    const { runQuickUpdate, onShowProgress, onUnavailable, scope } = mountQuickUpdate()

    await runQuickUpdate(inst)

    expect(onShowProgress).not.toHaveBeenCalled()
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(api.runAction).not.toHaveBeenCalled()
    scope.stop()
  })

  it('starts nothing when the running-instance guard declines', async () => {
    api.getDetailSections.mockResolvedValue(
      channelSections('stable', { stable: [updateAction('stable')] })
    )
    actionGuardSpies.checkBeforeAction.mockResolvedValue(false)
    const { runQuickUpdate, onShowProgress, scope } = mountQuickUpdate()

    await runQuickUpdate(inst)

    expect(dialogsSpies.confirm).not.toHaveBeenCalled()
    expect(onShowProgress).not.toHaveBeenCalled()
    scope.stop()
  })

  it.each([
    ['no update action is offered', () => api.getDetailSections.mockResolvedValue([])],
    [
      'the update action is disabled',
      () =>
        api.getDetailSections.mockResolvedValue(
          channelSections('stable', { stable: [updateAction('stable', { enabled: false })] })
        )
    ],
    [
      'the build details fail to load',
      () => api.getDetailSections.mockRejectedValue(new Error('boom'))
    ]
  ])('falls back to the build manager when %s', async (_case, arrange) => {
    arrange()
    const { runQuickUpdate, onShowProgress, onUnavailable, scope } = mountQuickUpdate()

    await runQuickUpdate(inst)

    expect(onUnavailable).toHaveBeenCalledWith(inst)
    expect(dialogsSpies.confirm).not.toHaveBeenCalled()
    expect(onShowProgress).not.toHaveBeenCalled()
    scope.stop()
  })
})
