import type { WebContents } from 'electron'

import { detectFirebaseEnv } from './config'
import {
  beginActiveBridgeFlow,
  isActiveBridgeFlow,
  openExternalSafely,
  releaseActiveBridgeFlow,
  runBannerCleanup,
  showCopyLinkBanner
} from './flowState'
import { abortable, abortableSleep } from './flowControl'
import {
  bindSignedInUser,
  emitSignInFailure,
  type HandleFirebasePopupOpts,
  isOnOrigin,
  originOf,
  POST_SIGNIN_HOLD_MS
} from './flowShared'
import {
  beginFirebaseSessionInjection,
  injectFirebaseSession,
  releaseFirebaseSessionInjection
} from './inject'
import { extractProviderId, type SupportedProvider } from './intercept'
import { restoreParentWindow } from './restoreParentWindow'
import { startBridgeServer, type BridgeHandle } from './server'
import { signInViaDesktopLoginCode } from '../desktopLoginCode'
import * as mainTelemetry from '../../lib/telemetry'

const LEGACY_AUTH_FLOW = 'loopback_bridge'

export { extractProviderId, isFirebaseAuthHandlerUrl } from './intercept'
export { bindSignedInUser, POST_SIGNIN_HOLD_MS } from './flowShared'
export type { HandleFirebasePopupOpts, SignInFailureContext } from './flowShared'
export { closeActiveBridge, runBannerCleanup, showCopyLinkBanner } from './flowState'

export async function handleFirebasePopup(
  url: string,
  comfyContents: WebContents,
  opts: HandleFirebasePopupOpts = {}
): Promise<void> {
  const outcome = await signInViaDesktopLoginCode(url, comfyContents, opts).catch(() => {
    console.error('Desktop login-code flow failed unexpectedly; using legacy fallback')
    return 'fallback' as const
  })
  if (outcome === 'handled') return

  const providerId = extractProviderId(url)
  if (!providerId) {
    const error = new Error(`Firebase popup URL missing providerId: ${url}`)
    const failure = emitSignInFailure('cloud', LEGACY_AUTH_FLOW, error)
    opts.onError?.(failure)
    return
  }
  mainTelemetry.capture('comfy.desktop.auth.sign_in_started', {
    provider: providerId,
    flow: LEGACY_AUTH_FLOW
  })
  const env = detectFirebaseEnv(url)

  const flow = beginActiveBridgeFlow()
  const sessionInjection = beginFirebaseSessionInjection(comfyContents)
  runBannerCleanup()

  const { signal } = flow.controller
  const startOrigin = originOf(comfyContents.getURL())
  let handle: BridgeHandle | null = null
  try {
    const startingBridge = startBridgeServer({ env, providerId })
    void startingBridge.then(
      (candidate) => {
        if (signal.aborted || !isActiveBridgeFlow(flow)) candidate.close()
      },
      () => {}
    )
    handle = await abortable(startingBridge, signal)
    if (signal.aborted || !isActiveBridgeFlow(flow)) {
      handle.close()
      return
    }
    flow.handle = handle
    const loginUrl = `${handle.url}?n=${Date.now().toString(36)}`
    openExternalSafely(loginUrl)
    showCopyLinkBanner(comfyContents, loginUrl)
    const { user, apiKey } = await abortable(handle.signInPromise, signal)
    if (signal.aborted || !isActiveBridgeFlow(flow)) return
    if (comfyContents.isDestroyed()) return
    await abortableSleep(POST_SIGNIN_HOLD_MS, signal)
    if (signal.aborted || !isActiveBridgeFlow(flow) || comfyContents.isDestroyed()) return
    if (!startOrigin || !isOnOrigin(comfyContents, startOrigin)) return
    const injected = await abortable(
      injectFirebaseSession(sessionInjection, startOrigin, user, apiKey),
      signal
    )
    if (!injected) return
    if (signal.aborted || !isActiveBridgeFlow(flow)) return
    bindSignedInUser(user, comfyContents)
    restoreParentWindow(opts.parentWindow)
  } catch (err) {
    if (signal.aborted || !isActiveBridgeFlow(flow)) return
    const error = err instanceof Error ? err : new Error(String(err))
    const failure = emitSignInFailure(providerId, LEGACY_AUTH_FLOW, error)
    opts.onError?.(failure)
  } finally {
    handle?.close()
    releaseFirebaseSessionInjection(sessionInjection)
    if (releaseActiveBridgeFlow(flow)) {
      runBannerCleanup()
    }
  }
}

export type { SupportedProvider }
