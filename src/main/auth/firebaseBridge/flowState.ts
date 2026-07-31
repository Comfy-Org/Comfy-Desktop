import { shell, type WebContents } from 'electron'

import {
  buildCopyLinkBannerScript,
  buildRemoveCopyLinkBannerScript,
  buildUpdateCopyLinkBannerScript,
  CANCEL_SIGN_IN_SENTINEL,
  COPY_LINK_BANNER_CSS,
  OPEN_LINK_SENTINEL,
  type SignInPanelStatus,
  START_OVER_SENTINEL
} from './copyLinkBanner'
import type { BridgeHandle } from './server'
import * as i18n from '../../lib/i18n'

export interface ActiveBridgeFlow {
  controller: AbortController
  handle: BridgeHandle | null
}

let activeBridgeFlow: ActiveBridgeFlow | null = null
let activeBannerCleanup: (() => void) | null = null

/**
 * Ask the OS to open a trusted auth URL.
 *
 * A resolved promise means only that the OS accepted the request; it does not
 * prove that a browser page loaded. Callers intentionally keep the sign-in
 * panel visible until the auth flow itself reaches a terminal result.
 */
export async function openExternalSafely(url: string): Promise<boolean> {
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

/** Replace any in-flight loopback flow with a new singleton owner. */
export function beginActiveBridgeFlow(): ActiveBridgeFlow {
  closeActiveBridge()
  const flow: ActiveBridgeFlow = { controller: new AbortController(), handle: null }
  activeBridgeFlow = flow
  return flow
}

export function isActiveBridgeFlow(flow: ActiveBridgeFlow): boolean {
  return activeBridgeFlow === flow
}

/** Release ownership without cancelling a flow that already completed. */
export function releaseActiveBridgeFlow(flow: ActiveBridgeFlow): boolean {
  if (activeBridgeFlow !== flow) return false
  activeBridgeFlow = null
  return true
}

/** Cancel + clear the in-flight loopback flow, if any. */
export function closeActiveBridge(): void {
  const flow = activeBridgeFlow
  if (!flow) return
  activeBridgeFlow = null
  flow.controller.abort()
  try {
    flow.handle?.close()
  } catch {
    // Best-effort cleanup.
  }
}

/** Run + clear the in-flight card teardown, if any. Safe to call twice. */
export function runBannerCleanup(): void {
  const cleanup = activeBannerCleanup
  activeBannerCleanup = null
  cleanup?.()
}

export interface SignInPanelHandlers {
  expiresAtMs?: number
  onCancel?: () => void
  onStartOver?: () => void
  onBrowserOpenResult?: (accepted: boolean, trigger: 'retry') => void
}

/** Inject the persistent sign-in panel and own its singleton teardown. */
export async function showCopyLinkBanner(
  comfyContents: WebContents,
  loginUrl: string,
  handlers: SignInPanelHandlers = {}
): Promise<void> {
  if (comfyContents.isDestroyed()) return
  let panelActive = true

  const labels = {
    title: i18n.t('cloud.signInBanner.title'),
    opening: i18n.t('cloud.signInBanner.opening'),
    waiting: i18n.t('cloud.signInBanner.waiting'),
    openFailed: i18n.t('cloud.signInBanner.openFailed'),
    expired: i18n.t('cloud.signInBanner.expired'),
    failed: i18n.t('cloud.signInBanner.failed'),
    remaining: i18n.t('cloud.signInBanner.remaining'),
    copy: i18n.t('cloud.signInBanner.copy'),
    copied: i18n.t('cloud.signInBanner.copied'),
    openAgain: i18n.t('cloud.signInBanner.openAgain'),
    cancel: i18n.t('cloud.signInBanner.cancel'),
    startOver: i18n.t('cloud.signInBanner.startOver')
  }

  const onConsoleMessage = (
    details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>
  ): void => {
    if (details.frame?.parent != null) return
    if (details.message === OPEN_LINK_SENTINEL) {
      void openExternalSafely(loginUrl).then((accepted) => {
        if (!panelActive) return
        updateSignInPanelStatus(comfyContents, accepted ? 'waiting' : 'open_failed')
        handlers.onBrowserOpenResult?.(accepted, 'retry')
      })
      return
    }
    if (details.message === CANCEL_SIGN_IN_SENTINEL) {
      handlers.onCancel?.()
      runBannerCleanup()
      return
    }
    if (details.message === START_OVER_SENTINEL) {
      handlers.onStartOver?.()
    }
  }
  comfyContents.on('console-message', onConsoleMessage)

  activeBannerCleanup = () => {
    panelActive = false
    comfyContents.off('console-message', onConsoleMessage)
    if (!comfyContents.isDestroyed()) {
      void comfyContents.executeJavaScript(buildRemoveCopyLinkBannerScript(), true).catch(() => {})
    }
  }

  await comfyContents
    .insertCSS(COPY_LINK_BANNER_CSS)
    .then(() => {
      if (!panelActive || comfyContents.isDestroyed()) return
      return comfyContents.executeJavaScript(
        buildCopyLinkBannerScript(loginUrl, labels, {
          expiresAtMs: handlers.expiresAtMs,
          status: 'opening'
        }),
        true
      )
    })
    .catch(() => {})
}

/** Best-effort status update for the current panel. */
export function updateSignInPanelStatus(
  comfyContents: WebContents,
  status: SignInPanelStatus
): void {
  if (comfyContents.isDestroyed()) return
  void comfyContents
    .executeJavaScript(buildUpdateCopyLinkBannerScript(status), true)
    .catch(() => {})
}
