import { app, ipcMain, shell, type IpcMainEvent, type WebContents } from 'electron'
import type { ComfyWindowEntry } from '../host/registry'
import {
  CUSTOMER_IO_DEFAULTS,
  CUSTOMER_IO_PAGES,
  CUSTOMER_IO_ACTION,
  CUSTOMER_IO_READY,
  CUSTOMER_IO_STATE
} from '../../shared/customerIo'
import type { CustomerIoSession } from '../../shared/customerIo'
import { getCustomerIoUserId } from './firebaseAuthIdentity'
import { customerIoEvents } from './customerIoEvents'
import * as settings from '../settings'
import * as i18n from './i18n'
import { isLoopbackOrigin } from './verifiedLocalFirebaseAuth'

const linkHandlers = new WeakMap<WebContents, (event: IpcMainEvent, action: unknown) => void>()
let linkHandlerInstalled = false

/** Only the attached, focused local ComfyUI document can receive Desktop messages. */
export function customerIoSession(entry: ComfyWindowEntry): CustomerIoSession | null {
  const enabled = process.env.COMFY_CUSTOMER_IO_ENABLED
  if (enabled === '0' || enabled === 'false' || (!app.isPackaged && enabled !== 'true')) return null
  if (settings.get('telemetryEnabled') !== true) return null
  if (
    entry.installationId === null ||
    entry.sourceCategory !== 'local' ||
    entry.activePanel !== 'comfy' ||
    !entry.window.isFocused() ||
    entry.window.isMinimized() ||
    !entry.comfyView.getVisible()
  )
    return null
  const contents = entry.comfyView.webContents
  if (contents.isDestroyed()) return null
  try {
    const url = new URL(contents.getURL())
    if (!isLoopbackOrigin(url.origin) || url.origin !== new URL(entry.comfyUrl).origin) return null
  } catch {
    return null
  }
  const userId = getCustomerIoUserId(contents)
  if (!userId) return null
  return {
    userId,
    page: CUSTOMER_IO_PAGES.comfyui,
    locale: i18n.getLocale(),
    writeKey: process.env.COMFY_CUSTOMER_IO_WRITE_KEY || CUSTOMER_IO_DEFAULTS.writeKey,
    siteId: process.env.COMFY_CUSTOMER_IO_SITE_ID || CUSTOMER_IO_DEFAULTS.siteId
  }
}

export function attachCustomerIoMessaging(entry: ComfyWindowEntry): () => void {
  if (!linkHandlerInstalled) {
    ipcMain.on(CUSTOMER_IO_ACTION, (event, action: unknown) => {
      // Always answer, including when a retained page has already detached.
      event.returnValue = false
      linkHandlers.get(event.sender)?.(event, action)
    })
    linkHandlerInstalled = true
  }
  const contents = entry.comfyView.webContents
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
  const refresh = (): void => send(customerIoSession(entry))
  const onReady = (event: IpcMainEvent, channel: string, action?: unknown): void => {
    if (channel !== CUSTOMER_IO_READY && channel !== CUSTOMER_IO_ACTION) return
    if (channel === CUSTOMER_IO_ACTION) event.returnValue = false
    const frame = event.senderFrame
    if (!frame || frame !== contents.mainFrame) return
    if (channel === CUSTOMER_IO_ACTION) {
      if (!customerIoSession(entry) || typeof action !== 'string') return
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
    refresh()
  }
  const onNavigation = (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
  ): void => {
    if (!details.isMainFrame || details.isSameDocument) return
    send(null)
    ready = false
    lastState = ''
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
  entry.window.on('focus', refresh)
  entry.window.on('blur', refresh)
  entry.window.on('minimize', refresh)
  entry.window.on('restore', refresh)
  customerIoEvents.on('changed', refresh)
  entry.refreshCustomerIo = refresh
  return () => {
    send(null)
    ready = false
    contents.off('ipc-message', onMessage)
    linkHandlers.delete(contents)
    contents.off('will-navigate', onLinkNavigation)
    contents.off('did-start-navigation', onNavigation)
    entry.window.off('focus', refresh)
    entry.window.off('blur', refresh)
    entry.window.off('minimize', refresh)
    entry.window.off('restore', refresh)
    customerIoEvents.off('changed', refresh)
    delete entry.refreshCustomerIo
  }
}
