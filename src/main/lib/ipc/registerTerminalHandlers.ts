import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { findEntryByComfySender } from '../../host/registry'
import { isTitlePopupSender } from '../../popups/titlePopup'
import {
  subscribeTerminal,
  unsubscribeTerminal,
  writeTerminal,
  resizeTerminal,
  restartTerminal,
  getTerminalRestore,
  type TerminalRestore
} from '../terminal'
import {
  findTerminalPopoutInstallationIdBySender,
  openTerminalPopout
} from '../terminalPopoutWindow'

/**
 * IPC for the interactive per-installation console.
 *
 * Only bundled Desktop terminal renderers may use these channels. The served
 * ComfyUI renderer has a separate navigation-only bridge.
 */

const EMPTY_RESTORE: TerminalRestore = {
  buffer: [],
  size: { cols: 80, rows: 30 },
  exited: true
}

function resolveInstallationId(
  event: IpcMainInvokeEvent,
  explicit: string | null | undefined
): string | null {
  const requestedId = typeof explicit === 'string' && explicit.length > 0 ? explicit : null
  if (isTitlePopupSender(event.sender)) return requestedId
  const popoutId = findTerminalPopoutInstallationIdBySender(event.sender)
  if (!popoutId || (requestedId && requestedId !== popoutId)) return null
  return popoutId
}

export function registerTerminalHandlers(): void {
  ipcMain.handle('desktop2-open-terminal-popout', async (event): Promise<void> => {
    const entry = findEntryByComfySender(event.sender)
    if (!entry?.installationId || entry.sourceCategory !== 'local') return
    await openTerminalPopout(entry.installationId)
  })

  ipcMain.handle(
    'terminal-subscribe',
    async (event, installationId?: string | null): Promise<TerminalRestore> => {
      const id = resolveInstallationId(event, installationId)
      if (!id) return EMPTY_RESTORE
      return subscribeTerminal(id, event.sender)
    }
  )

  ipcMain.handle('terminal-unsubscribe', (event, installationId?: string | null) => {
    const id = resolveInstallationId(event, installationId)
    if (id) unsubscribeTerminal(id, event.sender)
  })

  ipcMain.handle('terminal-write', (event, installationId: string | null, data: string) => {
    const id = resolveInstallationId(event, installationId)
    if (id) writeTerminal(id, data)
  })

  ipcMain.handle(
    'terminal-resize',
    (event, installationId: string | null, cols: number, rows: number) => {
      const id = resolveInstallationId(event, installationId)
      if (id) resizeTerminal(id, cols, rows)
    }
  )

  ipcMain.handle(
    'terminal-restart',
    async (event, installationId?: string | null): Promise<TerminalRestore> => {
      const id = resolveInstallationId(event, installationId)
      if (!id) return EMPTY_RESTORE
      return restartTerminal(id)
    }
  )

  ipcMain.handle('terminal-restore', (event, installationId?: string | null): TerminalRestore => {
    const id = resolveInstallationId(event, installationId)
    if (!id) return EMPTY_RESTORE
    return getTerminalRestore(id) ?? EMPTY_RESTORE
  })

  ipcMain.handle(
    'terminal-popout-open',
    async (event, installationId?: string | null): Promise<void> => {
      const id = resolveInstallationId(event, installationId)
      if (!id) return
      await openTerminalPopout(id)
    }
  )
}
