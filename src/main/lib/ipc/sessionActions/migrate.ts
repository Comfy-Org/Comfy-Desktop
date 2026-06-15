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
  makeSendOutput
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

// Build the in-app prompt spec for a prompt kind; each button maps to a UserChoice.
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
      // Only shown if the orchestrator escalates a runtime decision.
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

// Pending adopt prompts awaiting a renderer response, keyed by promptId.
interface PendingAdoptPrompt {
  webContentsId: number
  ack: () => void
  resolve: (buttonIndex: number) => void
  reject: (err: Error) => void
}
const pendingAdoptPrompts = new Map<string, PendingAdoptPrompt>()

// How long to wait for the renderer to ACK delivery before giving up. This
// only guards delivery (no window listening) — once ACKed, the user may take
// as long as they like to answer.
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

// A real renderer WebContents is an EventEmitter we can talk to. Synthetic
// dispatch paths (e.g. the picker's background-op stub) pass an object with
// only `send`/`isDestroyed`, which can't deliver an interactive prompt — and
// calling EventEmitter methods on it would throw. Validate up front so those
// callers fall back to cancel instead of crashing the main process.
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

// Best-effort listener removal that can never throw — a destroyed or stale
// wrapper may have lost its EventEmitter methods, and prompt cleanup must not
// surface an uncaught exception on the main-process event loop.
function removeDestroyedListenerSafe(
  sender: Electron.WebContents,
  listener: () => void
): void {
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
  } catch {
    // ignore
  }
}

// Ask the originating renderer to surface an in-app prompt and resolve to the
// chosen button index. Rejects (so the caller can fall back to cancel) if the
// window never ACKs, is destroyed, can't deliver prompts, or the operation
// aborts mid-prompt.
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
    const onDestroyed = (): void =>
      settle(() => reject(new Error('adopt-prompt-window-destroyed')))

    if (signal.aborted) {
      reject(new Error('adopt-prompt-aborted'))
      return
    }
    // Synthetic / destroyed senders can't deliver a prompt — bail before
    // arming any timer or registering listeners on a non-EventEmitter.
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
      // Sender went away between the capability check and send. Settle now
      // so the pending entry, listeners, and timer are cleaned up immediately.
      settle(() => reject(err instanceof Error ? err : new Error(String(err))))
    }
  })
}

// Resolve a UserChoice via an in-app dialog in the originating renderer.
// On any delivery failure we fall back to the prompt's cancel choice so
// adoption fails cleanly instead of blocking forever.
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
  // A malformed index (NaN / out of range / non-integer from a buggy renderer)
  // falls back to cancel rather than throwing.
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

  // Desktop source → adopt the legacy install in place (the legacy record
  // is left alone), returning a fresh standalone record.
  if (inst.sourceId === 'desktop') {
    let adopted: InstallationRecord | null = null
    try {
      adopted = await telemetry.trackedStep('comfy.desktop.migrate.flow', flowContext, async () => {
        return adoptDesktopInstall({
          tools: {
            sendProgress,
            sendOutput,
            signal: abort.signal,
            promptUser: (kind, ctx) => showAdoptPrompt(sender, abort.signal, kind, ctx)
          }
        })
      })
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
      // Adoption couldn't obtain the ComfyUI source (no staged copy and the
      // git clone failed). Fail clearly with a message that points the user
      // at doing a fresh install, rather than the old fake-success no-op.
      if (message.startsWith('source-missing')) {
        return { ok: false, message: i18n.t('desktop.adoptSourceMissingFailed') }
      }
      return { ok: false, message }
    }
  }

  // Non-desktop source → standard local-install migration.
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
      }
    )
    entry = result.entry
    destPath = result.destPath

    _operationAborts.delete(installationId)
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
    if (abort.signal.aborted) return { ok: true, navigate: 'detail' }
    return { ok: false, message: (err as Error).message }
  }
}
