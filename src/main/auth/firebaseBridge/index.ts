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
  POST_SIGNIN_HOLD_MS
} from './flowShared'
import { buildIndexedDbInjectScript } from './inject'
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

/**
 * Orchestrate the system-browser sign-in for a Firebase auth-handler
 * URL that the embedded cloud-workspace view tried to open via
 * `window.open()`.
 *
 * The Cloud login-code path runs first. If it cannot create a code before
 * opening the browser, the legacy loopback bridge takes over. Both paths
 * converge on the same IndexedDB user injection and parent-window restore.
 *
 * Errors are reported via the optional `onError` callback (the caller
 * forwards them to Datadog without taking down the embedded view).
 * Once either path opens the browser, errors are surfaced instead of starting
 * a competing sign-in mechanism underneath the active tab.
 */
export async function handleFirebasePopup(
  url: string,
  comfyContents: WebContents,
  opts: HandleFirebasePopupOpts = {}
): Promise<void> {
  // Prefer the cloud login-code flow (GTM-93): sign-in happens on the
  // real Cloud login page and Desktop polls for a one-time custom token —
  // no loopback server. 'fallback' means the flow died before the browser
  // opened (e.g. backend without the endpoints), so the legacy bridge
  // below takes over transparently.
  const outcome = await signInViaDesktopLoginCode(url, comfyContents, opts)
  if (outcome === 'handled') return

  const providerId = extractProviderId(url)
  if (!providerId) {
    const error = new Error(`Firebase popup URL missing providerId: ${url}`)
    const failure = emitSignInFailure('cloud', LEGACY_AUTH_FLOW, error)
    opts.onError?.(failure)
    return
  }
  // Sign-in funnel: started -> (app:user_logged_in | auth.sign_in_failed).
  // `provider` splits Google vs GitHub conversion + failure rates. The
  // success leg is emitted by bindSignedInUser's app:user_logged_in.
  mainTelemetry.capture('comfy.desktop.auth.sign_in_started', {
    provider: providerId,
    flow: LEGACY_AUTH_FLOW
  })
  const env = detectFirebaseEnv(url)

  // Kill any stale bridge from a prior sign-in attempt the user didn't
  // complete — otherwise the user sees an unhelpful auth/popup-blocked
  // error from the embedded view (we denied the popup but couldn't open
  // the replacement bridge on the taken port).
  const flow = beginActiveBridgeFlow()
  // Clear a prior attempt's "copy link" card + its console listener so a
  // new attempt doesn't stack a second card or leak a stale listener.
  runBannerCleanup()

  const { signal } = flow.controller
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
    // Append a per-attempt nonce so browsers don't focus an existing
    // stale tab from a previous (perhaps wrong-provider) sign-in
    // attempt. macOS Chrome / Safari treat shell.openExternal of an
    // identical URL as "focus the open tab" rather than "open fresh"
    // — without the nonce the user would still see yesterday's GitHub
    // bridge page when they intended to start a new Google flow.
    // Capture the full nonce'd URL once so the auto-opened tab, the
    // "Copy link" button, and "Open again" all hand out the same link.
    const loginUrl = `${handle.url}?n=${Date.now().toString(36)}`
    openExternalSafely(loginUrl)
    // Surface a Notion/Claude-style "didn't open? copy the link" card in
    // the Cloud view so users can finish sign-in in a non-default browser.
    showCopyLinkBanner(comfyContents, loginUrl)
    const { user, apiKey } = await abortable(handle.signInPromise, signal)
    if (signal.aborted || !isActiveBridgeFlow(flow)) return
    // Bind PostHog identity as soon as we have the user — independent of
    // the embedded-view reload below, so the merge happens even if the
    // window is torn down before the reload completes.
    bindSignedInUser(user)
    if (comfyContents.isDestroyed()) return
    // Hold for a beat so the user actually sees the "You're signed in"
    // page (with its synchronised countdown) before we yank focus back
    // to Desktop and reload the embedded view. Without this the focus
    // grab happens essentially instantly after the OAuth callback
    // lands, which feels jarring — they barely see the bridge confirm
    // success before Desktop snatches focus.
    await abortableSleep(POST_SIGNIN_HOLD_MS, signal)
    if (signal.aborted || !isActiveBridgeFlow(flow) || comfyContents.isDestroyed()) return
    await abortable(
      comfyContents.executeJavaScript(buildIndexedDbInjectScript(user, apiKey), true),
      signal
    )
    if (signal.aborted || !isActiveBridgeFlow(flow)) return
    // Pull the user back into the app after the browser completes sign-in.
    restoreParentWindow(opts.parentWindow)
  } catch (err) {
    if (signal.aborted || !isActiveBridgeFlow(flow)) return
    const error = err instanceof Error ? err : new Error(String(err))
    // Mirrored to Datadog (allow-list) so ops can alert if sign-in
    // breaks for a provider. error_bucket keeps the dashboard low-
    // cardinality; error_class adds a locale-independent type for grouping.
    // The raw message stays out by design (may carry tokens / URLs), so we
    // deliberately do NOT ship `error_message` / `error_signature` here.
    const failure = emitSignInFailure(providerId, LEGACY_AUTH_FLOW, error)
    opts.onError?.(failure)
  } finally {
    handle?.close()
    if (releaseActiveBridgeFlow(flow)) {
      // Tear down the card only if this attempt still owns it; a superseded
      // flow must not remove the newer attempt's banner.
      runBannerCleanup()
    }
  }
}

// Re-export the supported provider type for callers that need to
// narrow the union before passing to `handleFirebasePopup`.
export type { SupportedProvider }
