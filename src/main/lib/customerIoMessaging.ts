import { app, type WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeBodyMode, type ComfyWindowEntry } from '../host/registry'
import { CUSTOMER_IO_DEFAULTS, CUSTOMER_IO_PAGES } from '../../shared/customerIo'
import type { CustomerIoSession } from '../../shared/customerIo'
import { getCustomerIoUserId } from './firebaseAuthIdentity'
import { customerIoEvents } from './customerIoEvents'
import * as settings from '../settings'
import * as i18n from './i18n'
import { isLoopbackOrigin } from './verifiedLocalFirebaseAuth'
import { attachCustomerIoDocument } from './customerIoDocument'
import { getCloudSession } from '../devplatform/session'

function messagingEnabled(entry: ComfyWindowEntry): boolean {
  const enabled = process.env.COMFY_CUSTOMER_IO_ENABLED
  return (
    enabled !== '0' &&
    enabled !== 'false' &&
    (app.isPackaged || enabled === 'true') &&
    settings.get('telemetryEnabled') === true &&
    !entry.window.isDestroyed() &&
    entry.window.isVisible() &&
    entry.window.isFocused() &&
    !entry.window.isMinimized() &&
    entry.firstUseMode === 'none'
  )
}

/** Only the attached, focused local ComfyUI document can receive this identity. */
export function customerIoSession(entry: ComfyWindowEntry): CustomerIoSession | null {
  if (!messagingEnabled(entry)) return null
  if (
    entry.installationId === null ||
    entry.sourceCategory !== 'local' ||
    entry.activePanel !== 'comfy' ||
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

function launcherContents(entry: ComfyWindowEntry): WebContents | null {
  if (!messagingEnabled(entry) || settings.get('firstUseCompleted') !== true) return null
  const panel = entry.panelView
  if (!panel?.getVisible() || panel.webContents.isDestroyed()) return null
  const mode = computeBodyMode(entry)
  if (['comfy', 'progress', 'feedback', 'mcp-setup', 'announcement'].includes(mode)) return null
  try {
    const url = new URL(panel.webContents.getURL())
    const expected = process.env.ELECTRON_RENDERER_URL
      ? new URL('panel.html', `${process.env.ELECTRON_RENDERER_URL.replace(/\/+$/, '')}/`)
      : pathToFileURL(join(__dirname, '../renderer/panel.html'))
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) return null
  } catch {
    return null
  }
  return panel.webContents
}

/** Own both documents for the host lifetime, including install and panel replacement. */
export function attachCustomerIoMessaging(entry: ComfyWindowEntry): () => void {
  const documents = new Map<WebContents, ReturnType<typeof attachCustomerIoDocument>>()
  const cloud = getCloudSession()
  let launcher: WebContents | null = null
  let launcherUserId: string | null = null
  let generation = 0
  let disposed = false

  const sessionFor = (contents: WebContents): CustomerIoSession | null => {
    if (disposed) return null
    if (contents === entry.comfyView.webContents) return customerIoSession(entry)
    if (contents !== launcherContents(entry) || contents !== launcher || !launcherUserId)
      return null
    return {
      userId: launcherUserId,
      page: CUSTOMER_IO_PAGES.launcher,
      locale: i18n.getLocale(),
      writeKey: process.env.COMFY_CUSTOMER_IO_WRITE_KEY || CUSTOMER_IO_DEFAULTS.writeKey,
      siteId: process.env.COMFY_CUSTOMER_IO_SITE_ID || CUSTOMER_IO_DEFAULTS.siteId
    }
  }

  const publish = (): void => {
    // Revoke the previous surface before granting the selected one. Native view
    // visibility has already changed, and each document deduplicates its state.
    for (const [contents, document] of documents) {
      if (!sessionFor(contents)) document.refresh()
    }
    for (const [contents, document] of documents) {
      if (sessionFor(contents)) document.refresh()
    }
  }

  const refresh = (): void => {
    if (disposed) return
    const current = [entry.comfyView.webContents, entry.panelView?.webContents].filter(
      (contents): contents is WebContents => Boolean(contents && !contents.isDestroyed())
    )
    for (const [contents, document] of documents) {
      if (current.includes(contents)) continue
      document.dispose()
      documents.delete(contents)
    }
    for (const contents of current) {
      if (!documents.has(contents)) {
        documents.set(
          contents,
          attachCustomerIoDocument(
            contents,
            () => sessionFor(contents),
            () => {
              if (contents === launcher && !launcherUserId) launcher = null
              refresh()
            }
          )
        )
      }
    }

    const eligibleLauncher = launcherContents(entry)
    const nextLauncher =
      eligibleLauncher && documents.get(eligibleLauncher)?.isReady() ? eligibleLauncher : null
    if (nextLauncher !== launcher) {
      launcher = nextLauncher
      launcherUserId = null
      const revision = ++generation
      if (launcher) {
        void cloud.getUserIdentity().then(
          (identity) => {
            if (disposed || revision !== generation) return
            launcherUserId = identity?.firebaseUid ?? null
            publish()
          },
          () => {
            if (disposed || revision !== generation) return
            launcherUserId = null
            publish()
          }
        )
      }
    }
    publish()
  }

  const authChanged = (): void => {
    launcher = null
    launcherUserId = null
    generation++
    refresh()
  }
  const unsubscribeAuth = cloud.onAuthChanged(authChanged)
  entry.window.on('focus', refresh)
  entry.window.on('blur', refresh)
  entry.window.on('minimize', refresh)
  entry.window.on('restore', refresh)
  entry.window.on('show', refresh)
  entry.window.on('hide', refresh)
  customerIoEvents.on('changed', refresh)
  entry.refreshCustomerIo = refresh
  refresh()

  return () => {
    if (disposed) return
    disposed = true
    generation++
    for (const document of documents.values()) document.dispose()
    documents.clear()
    unsubscribeAuth()
    entry.window.off('focus', refresh)
    entry.window.off('blur', refresh)
    entry.window.off('minimize', refresh)
    entry.window.off('restore', refresh)
    entry.window.off('show', refresh)
    entry.window.off('hide', refresh)
    customerIoEvents.off('changed', refresh)
    delete entry.refreshCustomerIo
  }
}
