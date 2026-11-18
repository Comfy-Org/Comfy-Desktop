import type { HomeProgressRequest } from '../../types/ipc'
import type { WebContentsView } from 'electron'
import { computeBodyMode, findEntryByHostWindow, openOrFocusHomeHostWindow } from './registry'
import { ensurePanelView } from './panelView'

const OP_KINDS = new Set(['launch', 'install', 'update', 'destructive', 'snapshot', 'generic'])

export function parseHomeProgressRequest(raw: unknown): HomeProgressRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const { installationId, actionId, title, actionData, cancellable, opKind, relaunch } = value
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
        : undefined,
    relaunch: relaunch === true
  }
}

export function deliverWhenLoaded(
  panelView: WebContentsView,
  channel: string,
  payload: unknown
): Promise<boolean> {
  const contents = panelView.webContents
  if (contents.isDestroyed()) return Promise.resolve(false)
  if (!contents.isLoadingMainFrame()) {
    contents.send(channel, payload)
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const settle = (handedOff: boolean): void => {
      contents.off('did-finish-load', loaded)
      contents.off('did-fail-load', failed)
      contents.off('destroyed', lost)
      if (handedOff) contents.send(channel, payload)
      resolve(handedOff)
    }
    const loaded = (): void => settle(!contents.isDestroyed())
    const failed = (
      _event: unknown,
      _errorCode: number,
      _errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean
    ): void => {
      if (isMainFrame) settle(false)
    }
    const lost = (): void => settle(false)
    contents.on('did-finish-load', loaded)
    contents.on('did-fail-load', failed)
    contents.on('destroyed', lost)
  })
}

export function showProgressOnHome(raw: unknown): Promise<boolean> {
  const request = parseHomeProgressRequest(raw)
  if (!request) return Promise.resolve(false)
  const home = findEntryByHostWindow(openOrFocusHomeHostWindow())
  if (!home) return Promise.resolve(false)
  const panelView = home.panelView ?? ensurePanelView(home.windowKey, home, computeBodyMode(home))
  return deliverWhenLoaded(panelView, 'panel-trigger-overlay', {
    kind: 'picker-show-progress',
    ...request
  })
}
