import type { HomeProgressRequest } from '../../types/ipc'
import { comfyWindows, isChooserHost, openOrFocusHomeHostWindow } from './registry'
import { sendToPanelDeferred } from './panelView'

const OP_KINDS = new Set(['launch', 'install', 'update', 'destructive', 'snapshot', 'generic'])

export function parseHomeProgressRequest(raw: unknown): HomeProgressRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const { installationId, actionId, title, actionData, cancellable, opKind } = value
  if (typeof installationId !== 'string' || installationId === '') return null
  if (typeof actionId !== 'string' || actionId === '') return null
  if (typeof title !== 'string' || title === '') return null
  return {
    installationId,
    actionId,
    title,
    actionData:
      actionData && typeof actionData === 'object'
        ? (actionData as Record<string, unknown>)
        : undefined,
    cancellable: cancellable === true,
    opKind:
      typeof opKind === 'string' && OP_KINDS.has(opKind)
        ? (opKind as HomeProgressRequest['opKind'])
        : undefined
  }
}

export function showProgressOnHome(raw: unknown): boolean {
  const request = parseHomeProgressRequest(raw)
  if (!request) return false
  const homeWindow = openOrFocusHomeHostWindow()
  const home = [...comfyWindows.values()].find(
    (entry) => entry.window === homeWindow && isChooserHost(entry)
  )
  const panelView = home?.panelView
  if (!panelView || panelView.webContents.isDestroyed()) return false
  sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
    kind: 'picker-show-progress',
    ...request
  })
  return true
}
