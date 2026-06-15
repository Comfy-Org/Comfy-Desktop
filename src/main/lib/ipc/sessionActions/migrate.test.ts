// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InstallationRecord } from '../../../installations'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getVersion: () => '0.0.0-test', getLocale: () => 'en' },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  shell: {},
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
}))

vi.mock('../../i18n', () => ({
  t: (key: string) => key,
  init: vi.fn(async () => {}),
  getMessages: () => ({}),
  getLocale: () => 'en',
}))

vi.mock('../../telemetry', () => ({
  capture: vi.fn(),
  bucketError: vi.fn(() => 'other'),
  trackedStep: vi.fn(async (_step: string, _ctx: unknown, fn: () => Promise<unknown>) => fn()),
}))

const { performLocalMigrationMock, adoptDesktopInstallMock, ipcMainHandlers } = vi.hoisted(() => ({
  performLocalMigrationMock: vi.fn(),
  adoptDesktopInstallMock: vi.fn(),
  ipcMainHandlers: new Map<string, (event: unknown, payload: unknown) => void>(),
}))

vi.mock('../../desktopAdopt', () => ({
  adoptDesktopInstall: adoptDesktopInstallMock,
}))

vi.mock('../shared', () => ({
  fs: { existsSync: vi.fn(() => false), promises: { rm: vi.fn(async () => {}) } },
  ipcMain: {
    on: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => void) => {
      ipcMainHandlers.set(channel, handler)
    }),
  },
  installations: { remove: vi.fn(async () => {}) },
  i18n: { t: (k: string) => k },
  performLocalMigration: performLocalMigrationMock,
  _operationAborts: new Map(),
  sourceMap: {},
  uniqueName: vi.fn(async (s: string) => s),
  makeSendProgress: vi.fn(() => vi.fn()),
  makeSendOutput: vi.fn(() => vi.fn()),
}))

import { handleMigrateToStandalone } from './migrate'

function makeContext(
  inst: Partial<InstallationRecord>,
  sender?: unknown
): Parameters<typeof handleMigrateToStandalone>[0] {
  const installation = {
    id: 'src-1',
    name: 'Legacy',
    createdAt: '2026-01-01T00:00:00.000Z',
    installPath: '/legacy',
    sourceId: 'desktop',
    ...inst,
  } as InstallationRecord
  return {
    event: {
      sender: sender ?? { send: vi.fn() },
    } as unknown as Electron.IpcMainInvokeEvent,
    installationId: installation.id,
    inst: installation,
    actionData: {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleMigrateToStandalone — desktop branch', () => {
  it('routes desktop source to adoptDesktopInstall and returns the newly-adopted id', async () => {
    adoptDesktopInstallMock.mockResolvedValueOnce({
      id: 'inst-adopted-1',
      installPath: '/adopted',
    } as InstallationRecord)

    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'desktop' }))

    expect(adoptDesktopInstallMock).toHaveBeenCalledOnce()
    expect(performLocalMigrationMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      navigate: 'list',
      newInstallationId: 'inst-adopted-1',
    })
  })

  it('fails clearly when adoption cannot source ComfyUI (no fake-success fallback)', async () => {
    adoptDesktopInstallMock.mockRejectedValueOnce(
      new Error('source-missing: git clone failed')
    )
    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'desktop' }))
    expect(result).toEqual({ ok: false, message: 'desktop.adoptSourceMissingFailed' })
  })

  it('surfaces other adoption errors as failure results', async () => {
    adoptDesktopInstallMock.mockRejectedValueOnce(new Error('no-legacy-install'))
    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'desktop' }))
    expect(result).toEqual({ ok: false, message: 'no-legacy-install' })
  })

  it('resolves adoption prompts via an in-app IPC round-trip (no native dialog)', async () => {
    type SentMessage = { channel: string; payload: { promptId: string; defaultId: number } }
    const sent: SentMessage[] = []
    const sender = {
      id: 42,
      send: vi.fn((channel: string, payload: SentMessage['payload']) =>
        sent.push({ channel, payload })
      ),
      isDestroyed: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
    }

    // Simulate the adoption backend asking the user a question mid-operation,
    // and the renderer answering with the primary (retry) button.
    adoptDesktopInstallMock.mockImplementationOnce(
      async ({ tools }: { tools: { promptUser: (k: string, c: unknown) => Promise<unknown> } }) => {
        const choicePromise = tools.promptUser('source-missing', { message: 'git clone failed' })
        // Let the prompt request flush to the renderer.
        await Promise.resolve()
        const req = sent.find((s) => s.channel === 'adopt-prompt')!.payload
        const event = { sender: { id: 42 } }
        ipcMainHandlers.get('adopt-prompt-ack')!(event, { promptId: req.promptId })
        ipcMainHandlers.get('adopt-prompt-response')!(event, {
          promptId: req.promptId,
          buttonIndex: req.defaultId,
        })
        const choice = await choicePromise
        expect(choice).toEqual({ kind: 'source-missing', choice: 'retry' })
        return { id: 'inst-adopted-1', installPath: '/adopted' } as InstallationRecord
      }
    )

    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'desktop' }, sender))

    expect(sent.some((s) => s.channel === 'adopt-prompt')).toBe(true)
    expect(result).toEqual({
      ok: true,
      navigate: 'list',
      newInstallationId: 'inst-adopted-1',
    })
  })

  it('ignores a prompt response from the wrong renderer, then resolves on the right one', async () => {
    type SentMessage = { channel: string; payload: { promptId: string; cancelId: number } }
    const sent: SentMessage[] = []
    const sender = {
      id: 7,
      send: vi.fn((channel: string, payload: SentMessage['payload']) =>
        sent.push({ channel, payload })
      ),
      isDestroyed: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
    }

    adoptDesktopInstallMock.mockImplementationOnce(
      async ({ tools }: { tools: { promptUser: (k: string, c: unknown) => Promise<unknown> } }) => {
        const choicePromise = tools.promptUser('source-missing', { message: 'boom' })
        await Promise.resolve()
        const req = sent.find((s) => s.channel === 'adopt-prompt')!.payload
        // Wrong sender id → must be ignored.
        ipcMainHandlers.get('adopt-prompt-response')!(
          { sender: { id: 999 } },
          { promptId: req.promptId, buttonIndex: 0 }
        )
        // Right sender id → resolves with cancel.
        ipcMainHandlers.get('adopt-prompt-response')!(
          { sender: { id: 7 } },
          { promptId: req.promptId, buttonIndex: req.cancelId }
        )
        const choice = await choicePromise
        expect(choice).toEqual({ kind: 'source-missing', choice: 'cancel' })
        throw new Error('source-missing: cancelled')
      }
    )

    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'desktop' }, sender))
    expect(result).toEqual({ ok: false, message: 'desktop.adoptSourceMissingFailed' })
  })

  it('falls back to cancel when the renderer sends a malformed button index', async () => {
    type SentMessage = { channel: string; payload: { promptId: string } }
    const sent: SentMessage[] = []
    const sender = {
      id: 8,
      send: vi.fn((channel: string, payload: SentMessage['payload']) =>
        sent.push({ channel, payload })
      ),
      isDestroyed: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
    }

    adoptDesktopInstallMock.mockImplementationOnce(
      async ({ tools }: { tools: { promptUser: (k: string, c: unknown) => Promise<unknown> } }) => {
        const choicePromise = tools.promptUser('source-missing', { message: 'boom' })
        await Promise.resolve()
        const req = sent.find((s) => s.channel === 'adopt-prompt')!.payload
        // NaN is not a valid index — must map to cancel, never throw.
        ipcMainHandlers.get('adopt-prompt-response')!(
          { sender: { id: 8 } },
          { promptId: req.promptId, buttonIndex: Number.NaN }
        )
        const choice = await choicePromise
        expect(choice).toEqual({ kind: 'source-missing', choice: 'cancel' })
        throw new Error('source-missing: cancelled')
      }
    )

    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'desktop' }, sender))
    expect(result).toEqual({ ok: false, message: 'desktop.adoptSourceMissingFailed' })
  })

  it('falls back to cancel without crashing when the sender cannot deliver prompts (no EventEmitter methods)', async () => {
    type SentMessage = { channel: string; payload: { promptId: string } }
    const sent: SentMessage[] = []
    // Mirrors the picker background-op stub sender: has send/isDestroyed but
    // no once/removeListener. Must reject cleanly, never arm a timer, and
    // never throw an uncaught exception in main.
    const sender = {
      id: 5,
      send: vi.fn((channel: string, payload: SentMessage['payload']) =>
        sent.push({ channel, payload })
      ),
      isDestroyed: () => false,
    }

    adoptDesktopInstallMock.mockImplementationOnce(
      async ({ tools }: { tools: { promptUser: (k: string, c: unknown) => Promise<unknown> } }) => {
        const choice = await tools.promptUser('source-missing', { message: 'boom' })
        // Incapable sender: no prompt sent, immediate cancel fallback.
        expect(sent.some((s) => s.channel === 'adopt-prompt')).toBe(false)
        expect(choice).toEqual({ kind: 'source-missing', choice: 'cancel' })
        throw new Error('source-missing: cancelled')
      }
    )

    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'desktop' }, sender))
    expect(result).toEqual({ ok: false, message: 'desktop.adoptSourceMissingFailed' })
  })
})

describe('handleMigrateToStandalone — non-desktop branch', () => {
  it('routes non-desktop source to performLocalMigration', async () => {
    performLocalMigrationMock.mockResolvedValueOnce({
      entry: { id: 'inst-mig-1' },
      destPath: '/dest',
    })
    const result = await handleMigrateToStandalone(makeContext({ sourceId: 'standalone' }))

    expect(performLocalMigrationMock).toHaveBeenCalledOnce()
    expect(adoptDesktopInstallMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, navigate: 'list' })
  })
})
