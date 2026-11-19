import { randomUUID } from 'node:crypto'
import {
  fs,
  ipcMain,
  installations,
  i18n,
  performLocalMigration,
  _operationAborts,
  sourceMap,
  uniqueName,
  makeSendProgress,
  makeSendOutput,
  snapshotRestoreFailureResult
} from '../shared'
import type { InstallationRecord } from '../shared'
import { adoptDesktopInstall, type AdoptPromptKind, type UserChoice } from '../../desktopAdopt'
import type { ActionContext, ActionResult } from './types'
import type { AdoptPromptAck, AdoptPromptResponse } from '../../../../types/ipc'
import * as telemetry from '../../telemetry'

interface PromptSpec {
  type: 'info' | 'warning' | 'error' | 'question'
  title: string
  message: string
  detail?: string
  buttons: Array<{ label: string; choice: UserChoice }>
  defaultId: number
  cancelId: number
}

function buildAdoptPromptSpec(kind: AdoptPromptKind, ctx: unknown): PromptSpec {
  const data = (ctx ?? {}) as Record<string, unknown>
  switch (kind) {
    case 'tcc':
      return {
        type: 'info',
        title: i18n.t('desktop.adoptPromptTccTitle'),
        message: i18n.t('desktop.adoptPromptTccMessage'),
        buttons: [{ label: i18n.t('common.cancel'), choice: { kind: 'tcc', choice: 'denied' } }],
        defaultId: 0,
        cancelId: 0
      }
    case 'venv-broken':
      return {
        type: 'warning',
        title: i18n.t('desktop.adoptPromptVenvBrokenTitle'),
        message: i18n.t('desktop.adoptPromptVenvBrokenMessage'),
        detail: typeof data['message'] === 'string' ? (data['message'] as string) : undefined,
        buttons: [
          {
            label: i18n.t('desktop.adoptPromptUseAnyway'),
            choice: { kind: 'venv-broken', choice: 'use-anyway' }
          },
          { label: i18n.t('common.cancel'), choice: { kind: 'venv-broken', choice: 'cancel' } }
        ],
        defaultId: 0,
        cancelId: 1
      }
    case 'source-missing':
      return {
        type: 'error',
        title: i18n.t('desktop.adoptPromptSourceMissingTitle'),
        message: i18n.t('desktop.adoptPromptSourceMissingMessage'),
        detail: typeof data['message'] === 'string' ? (data['message'] as string) : undefined,
        buttons: [
          {
            label: i18n.t('desktop.adoptPromptRetry'),
            choice: { kind: 'source-missing', choice: 'retry' }
          },
          { label: i18n.t('common.cancel'), choice: { kind: 'source-missing', choice: 'cancel' } }
        ],
        defaultId: 0,
        cancelId: 1
      }
    case 'confirm-adopt':
      return {
        type: 'question',
        title: i18n.t('desktop.adoptConfirmTitle'),
        message: i18n.t('desktop.adoptConfirmMessage'),
        buttons: [
          {
            label: i18n.t('desktop.adoptConfirm'),
            choice: { kind: 'confirm-adopt', choice: 'yes' }
          },
          { label: i18n.t('common.cancel'), choice: { kind: 'confirm-adopt', choice: 'no' } }
        ],
        defaultId: 0,
        cancelId: 1
      }
  }
}

interface PendingAdoptPrompt {
  webContentsId: number
  ack: () => void
  resolve: (buttonIndex: number) => void
  reject: (err: Error) => void
}
const pendingAdoptPrompts = new Map<string, PendingAdoptPrompt>()

const ADOPT_PROMPT_ACK_TIMEOUT_MS = 5_000

let adoptPromptHandlersRegistered = false
function ensureAdoptPromptHandlers(): void {
  if (adoptPromptHandlersRegistered) return
  adoptPromptHandlersRegistered = true
  ipcMain.on('adopt-prompt-ack', (event, payload: AdoptPromptAck) => {
    const pending = pendingAdoptPrompts.get(payload?.promptId)
    if (!pending || pending.webContentsId !== event.sender.id) return
    pending.ack()
  })
  ipcMain.on('adopt-prompt-response', (event, payload: AdoptPromptResponse) => {
    const pending = pendingAdoptPrompts.get(payload?.promptId)
    if (!pending || pending.webContentsId !== event.sender.id) return
    pending.resolve(payload.buttonIndex)
  })
}

function isPromptCapableSender(sender: Electron.WebContents): boolean {
  const maybe = sender as Partial<Electron.WebContents>
  return (
    typeof maybe.id === 'number' &&
    typeof maybe.isDestroyed === 'function' &&
    typeof maybe.send === 'function' &&
    typeof maybe.once === 'function' &&
    !maybe.isDestroyed()
  )
}

function removeDestroyedListenerSafe(sender: Electron.WebContents, listener: () => void): void {
  type ListenerRemover = (event: string, listener: (...args: unknown[]) => void) => void
  const maybe = sender as unknown as {
    removeListener?: ListenerRemover
    off?: ListenerRemover
  }
  const remove =
    typeof maybe.removeListener === 'function'
      ? maybe.removeListener
      : typeof maybe.off === 'function'
        ? maybe.off
        : null
  if (!remove) return
  try {
    remove.call(sender, 'destroyed', listener)
  } catch {}
}

function requestAdoptPromptButton(
  sender: Electron.WebContents,
  signal: AbortSignal,
  spec: PromptSpec
): Promise<number> {
  ensureAdoptPromptHandlers()
  const promptId = randomUUID()
  return new Promise<number>((resolve, reject) => {
    let settled = false
    let ackTimer: ReturnType<typeof setTimeout> | null = null
    let destroyedListenerRegistered = false
    const cleanup = (): void => {
      pendingAdoptPrompts.delete(promptId)
      signal.removeEventListener('abort', onAbort)
      if (destroyedListenerRegistered) removeDestroyedListenerSafe(sender, onDestroyed)
      if (ackTimer) {
        clearTimeout(ackTimer)
        ackTimer = null
      }
    }
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const onAbort = (): void => settle(() => reject(new Error('adopt-prompt-aborted')))
    const onDestroyed = (): void => settle(() => reject(new Error('adopt-prompt-window-destroyed')))

    if (signal.aborted) {
      reject(new Error('adopt-prompt-aborted'))
      return
    }
    if (!isPromptCapableSender(sender)) {
      reject(new Error('adopt-prompt-unavailable'))
      return
    }

    signal.addEventListener('abort', onAbort, { once: true })
    try {
      sender.once('destroyed', onDestroyed)
      destroyedListenerRegistered = true
    } catch (err) {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))))
      return
    }

    ackTimer = setTimeout(
      () => settle(() => reject(new Error('adopt-prompt-unavailable'))),
      ADOPT_PROMPT_ACK_TIMEOUT_MS
    )

    pendingAdoptPrompts.set(promptId, {
      webContentsId: sender.id,
      ack: () => {
        if (ackTimer) {
          clearTimeout(ackTimer)
          ackTimer = null
        }
      },
      resolve: (buttonIndex) => settle(() => resolve(buttonIndex)),
      reject: (err) => settle(() => reject(err))
    })

    try {
      sender.send('adopt-prompt', {
        promptId,
        type: spec.type,
        title: spec.title,
        message: spec.message,
        detail: spec.detail,
        detailLabel: spec.detail ? i18n.t('desktop.adoptPromptDetail') : undefined,
        buttons: spec.buttons.map((b) => b.label),
        defaultId: spec.defaultId,
        cancelId: spec.cancelId
      })
    } catch (err) {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))))
    }
  })
}

async function showAdoptPrompt(
  sender: Electron.WebContents,
  signal: AbortSignal,
  kind: AdoptPromptKind,
  ctx: unknown
): Promise<UserChoice> {
  const spec = buildAdoptPromptSpec(kind, ctx)
  let idx = spec.cancelId
  try {
    if (!sender.isDestroyed()) {
      idx = await requestAdoptPromptButton(sender, signal, spec)
    }
  } catch {
    idx = spec.cancelId
  }
  const safe = Number.isInteger(idx) ? idx : spec.cancelId
  const clamped = Math.max(0, Math.min(safe, spec.buttons.length - 1))
  return (spec.buttons[clamped] ?? spec.buttons[spec.cancelId] ?? spec.buttons[0]!).choice
}

export async function handleMigrateToStandalone({
  event,
  installationId,
  inst,
  actionData
}: ActionContext): Promise<ActionResult> {
  if (_operationAborts.has(installationId)) {
    return { ok: false, message: 'Another operation is already running for this installation.' }
  }

  const sender = event.sender
  const sendProgress = makeSendProgress(sender, installationId)
  const sendOutput = makeSendOutput(sender, installationId)

  const abort = new AbortController()
  _operationAborts.set(installationId, abort)

  const flowContext = {
    source_id: inst.sourceId as string,
    source_installation_id: inst.id
  }

  if (inst.sourceId === 'desktop') {
    let adopted: InstallationRecord | null = null
    try {
      adopted = await telemetry.trackedStep(
        'comfy.desktop.migrate.flow',
        flowContext,
        async () => {
          return adoptDesktopInstall({
            tools: {
              sendProgress,
              sendOutput,
              signal: abort.signal,
              promptUser: (kind, ctx) => showAdoptPrompt(sender, abort.signal, kind, ctx)
            }
          })
        },
        { canonicalError: true }
      )
      _operationAborts.delete(installationId)
      sendProgress('done', { percent: 100, status: i18n.t('common.done') })
      return { ok: true, navigate: 'list', newInstallationId: adopted.id }
    } catch (err) {
      _operationAborts.delete(installationId)
      if (adopted) {
        try {
          await installations.remove(adopted.id)
          if (adopted.installPath && fs.existsSync(adopted.installPath)) {
            await fs.promises.rm(adopted.installPath, { recursive: true, force: true })
          }
        } catch {}
      }
      if (abort.signal.aborted) return { ok: true, navigate: 'detail' }
      const message = (err as Error).message
      if (message.startsWith('source-missing')) {
        return { ok: false, message: i18n.t('desktop.adoptSourceMissingFailed') }
      }
      return { ok: false, message }
    }
  }

  let entry: InstallationRecord | null = null
  let destPath = ''
  try {
    const migrationTools = {
      sendProgress,
      sendOutput,
      signal: abort.signal,
      sourceMap,
      uniqueName
    }
    const result = await telemetry.trackedStep(
      'comfy.desktop.migrate.flow',
      flowContext,
      async () => {
        return performLocalMigration(inst, actionData, migrationTools)
      },
      { canonicalError: true }
    )
    entry = result.entry
    destPath = result.destPath

    _operationAborts.delete(installationId)
    if (result.restoreError) {
      return snapshotRestoreFailureResult(installationId, result.restoreError)
    }
    sendProgress('done', { percent: 100, status: 'Complete' })
    return { ok: true, navigate: 'list' }
  } catch (err) {
    _operationAborts.delete(installationId)
    if (entry) {
      try {
        await installations.remove(entry.id)
      } catch {}
    }
    if (destPath && fs.existsSync(destPath)) {
      try {
        await fs.promises.rm(destPath, { recursive: true, force: true })
      } catch {}
    }
    if (abort.signal.aborted) return { ok: false, cancelled: true, navigate: 'detail' }
    return { ok: false, message: (err as Error).message }
  }
}
