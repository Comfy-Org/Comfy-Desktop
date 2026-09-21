import { ipcMain, shell, type IpcMainEvent, type WebContents } from 'electron'
import { CUSTOMER_IO_ACTION, CUSTOMER_IO_READY, CUSTOMER_IO_STATE } from '../../shared/customerIo'
import type { CustomerIoSession } from '../../shared/customerIo'
import { isLoopbackOrigin } from './verifiedLocalFirebaseAuth'

const linkHandlers = new WeakMap<WebContents, (event: IpcMainEvent, action: unknown) => void>()
let linkHandlerInstalled = false

export function attachCustomerIoDocument(
  contents: WebContents,
  getSession: () => CustomerIoSession | null,
  documentChanged: () => void
): { refresh: () => void; dispose: () => void; isReady: () => boolean } {
  if (!linkHandlerInstalled) {
    ipcMain.on(CUSTOMER_IO_ACTION, (event, action: unknown) => {
      // Always answer, including when a retained page has already detached.
      event.returnValue = false
      linkHandlers.get(event.sender)?.(event, action)
    })
    linkHandlerInstalled = true
  }
  let ready = false
  let lastState = ''
  let pendingNavigation: string | null = null
  const send = (state: CustomerIoSession | null): void => {
    if (!ready || contents.isDestroyed()) return
    const serialized = JSON.stringify(state)
    if (serialized === lastState) return
    try {
      // Pin the recipient to the current document, rather than a replacement navigation.
      contents.mainFrame.send(CUSTOMER_IO_STATE, state)
      lastState = serialized
    } catch {
      ready = false
      lastState = ''
    }
  }
  const refresh = (): void => send(getSession())
  const onReady = (event: IpcMainEvent, channel: string, action?: unknown): void => {
    if (channel !== CUSTOMER_IO_READY && channel !== CUSTOMER_IO_ACTION) return
    if (channel === CUSTOMER_IO_ACTION) event.returnValue = false
    const frame = event.senderFrame
    if (!frame || frame !== contents.mainFrame) return
    if (channel === CUSTOMER_IO_ACTION) {
      if (!ready || !getSession() || typeof action !== 'string') return
      try {
        const navigation = action.startsWith('gist://loadPage?url=')
        const url = new URL(
          navigation ? action.slice('gist://loadPage?url='.length) : action,
          contents.getURL()
        )
        // Block workflow replacement even for unsupported relative/local links.
        if (navigation) pendingNavigation = url.href
        if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return
        if (isLoopbackOrigin(url.origin)) return
        // A synchronous acknowledgement installs this guard before the SDK tries
        // to navigate ComfyUI away from the user's workflow.
        void shell.openExternal(url.href).catch(() => {})
        event.returnValue = true
      } catch {
        /* Unsupported actions are left to the in-app SDK. */
      }
      return
    }
    ready = true
    lastState = ''
    documentChanged()
    refresh()
  }
  const onNavigation = (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
  ): void => {
    if (!details.isMainFrame || details.isSameDocument) return
    send(null)
    ready = false
    lastState = ''
    documentChanged()
  }
  const onLinkNavigation = (event: Electron.Event, url: string): void => {
    if (url !== pendingNavigation) return
    pendingNavigation = null
    event.preventDefault()
  }
  const onMessage = (event: IpcMainEvent, channel: string): void => {
    if (channel === CUSTOMER_IO_READY) onReady(event, channel)
  }
  contents.on('ipc-message', onMessage)
  linkHandlers.set(contents, (event, action) => onReady(event, CUSTOMER_IO_ACTION, action))
  contents.on('will-navigate', onLinkNavigation)
  contents.on('did-start-navigation', onNavigation)
  const dispose = (): void => {
    send(null)
    ready = false
    contents.off('ipc-message', onMessage)
    linkHandlers.delete(contents)
    contents.off('will-navigate', onLinkNavigation)
    contents.off('did-start-navigation', onNavigation)
  }
  return { refresh, dispose, isReady: () => ready }
}
