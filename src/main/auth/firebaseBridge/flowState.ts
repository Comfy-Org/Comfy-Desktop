import { shell, type WebContents } from 'electron'

import {
  buildCopyLinkBannerScript,
  buildRemoveCopyLinkBannerScript,
  COPY_LINK_BANNER_CSS,
  OPEN_LINK_SENTINEL
} from './copyLinkBanner'
import type { BridgeHandle } from './server'
import * as i18n from '../../lib/i18n'

export interface ActiveBridgeFlow {
  controller: AbortController
  handle: BridgeHandle | null
}

let activeBridgeFlow: ActiveBridgeFlow | null = null
let activeBannerCleanup: (() => void) | null = null

export function openExternalSafely(url: string): void {
  void shell.openExternal(url).catch(() => {})
}

export function beginActiveBridgeFlow(): ActiveBridgeFlow {
  closeActiveBridge()
  const flow: ActiveBridgeFlow = { controller: new AbortController(), handle: null }
  activeBridgeFlow = flow
  return flow
}

export function isActiveBridgeFlow(flow: ActiveBridgeFlow): boolean {
  return activeBridgeFlow === flow
}

export function releaseActiveBridgeFlow(flow: ActiveBridgeFlow): boolean {
  if (activeBridgeFlow !== flow) return false
  activeBridgeFlow = null
  return true
}

export function closeActiveBridge(): void {
  const flow = activeBridgeFlow
  if (!flow) return
  activeBridgeFlow = null
  flow.controller.abort()
  try {
    flow.handle?.close()
  } catch {}
}

export function runBannerCleanup(): void {
  const cleanup = activeBannerCleanup
  activeBannerCleanup = null
  cleanup?.()
}

export function showCopyLinkBanner(comfyContents: WebContents, loginUrl: string): void {
  if (comfyContents.isDestroyed()) return

  const labels = {
    message: i18n.t('cloud.signInBanner.message'),
    copy: i18n.t('cloud.signInBanner.copy'),
    copied: i18n.t('cloud.signInBanner.copied'),
    openAgain: i18n.t('cloud.signInBanner.openAgain'),
    dismiss: i18n.t('cloud.signInBanner.dismiss')
  }

  void comfyContents
    .insertCSS(COPY_LINK_BANNER_CSS)
    .then(() => comfyContents.executeJavaScript(buildCopyLinkBannerScript(loginUrl, labels), true))
    .catch(() => {})

  const onConsoleMessage = (
    details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>
  ): void => {
    if (details.frame?.parent != null || details.message !== OPEN_LINK_SENTINEL) return
    openExternalSafely(loginUrl)
  }
  comfyContents.on('console-message', onConsoleMessage)

  activeBannerCleanup = () => {
    comfyContents.off('console-message', onConsoleMessage)
    if (!comfyContents.isDestroyed()) {
      void comfyContents.executeJavaScript(buildRemoveCopyLinkBannerScript(), true).catch(() => {})
    }
  }
}
