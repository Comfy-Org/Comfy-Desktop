import { shell, type WebContents } from 'electron'

import {
  buildCopyLinkBannerScript,
  buildRemoveCopyLinkBannerScript,
  COPY_LINK_BANNER_CSS,
  type CopyLinkBannerLabels,
  OPEN_LINK_SENTINEL,
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

/** Open a trusted auth URL without leaking a rejected Electron promise. */
export function openExternalSafely(url: string): void {
  void shell.openExternal(url).catch(() => {})
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

/**
 * Inject the browser-opened card and own its singleton teardown. With
 * `onStartOver` the card offers a "Start over" button that replaces the
 * in-flight sign-in attempt.
 */
export function showCopyLinkBanner(
  comfyContents: WebContents,
  loginUrl: string,
  onStartOver?: () => void
): void {
  if (comfyContents.isDestroyed()) return

  const labels: CopyLinkBannerLabels = {
    message: i18n.t('cloud.signInBanner.message'),
    copy: i18n.t('cloud.signInBanner.copy'),
    copied: i18n.t('cloud.signInBanner.copied'),
    openAgain: i18n.t('cloud.signInBanner.openAgain'),
    dismiss: i18n.t('cloud.signInBanner.dismiss')
  }
  if (onStartOver) labels.startOver = i18n.t('cloud.signInBanner.startOver')

  void comfyContents
    .insertCSS(COPY_LINK_BANNER_CSS)
    .then(() => comfyContents.executeJavaScript(buildCopyLinkBannerScript(loginUrl, labels), true))
    .catch(() => {})

  // One-shot per card: the page can emit the sentinel too, so a spammy page
  // (or double-click) must not restart sign-in more than once per attempt.
  let startedOver = false
  const onConsoleMessage = (
    details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>
  ): void => {
    if (details.frame?.parent != null) return
    if (details.message === OPEN_LINK_SENTINEL) {
      openExternalSafely(loginUrl)
    } else if (details.message === START_OVER_SENTINEL && onStartOver && !startedOver) {
      startedOver = true
      onStartOver()
    }
  }
  comfyContents.on('console-message', onConsoleMessage)

  activeBannerCleanup = () => {
    comfyContents.off('console-message', onConsoleMessage)
    if (!comfyContents.isDestroyed()) {
      void comfyContents.executeJavaScript(buildRemoveCopyLinkBannerScript(), true).catch(() => {})
    }
  }
}
