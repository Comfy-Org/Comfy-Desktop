import { app, type WebContents } from 'electron'

import {
  createDesktopLoginCode,
  type CreateDesktopLoginCodeRequest,
  DesktopLoginCodeError,
  type DesktopLoginCodeGrant,
  exchangeDesktopLoginCode
} from './client'
import {
  buildPersistedUserFromCustomToken,
  lookupAccount,
  signInWithCustomToken
} from './customTokenSignIn'
import { CLOUD_LOGIN_ORIGIN, cloudLoginOriginForUrl } from './origins'
import { codeChallengeS256, createCodeVerifier } from './pkce'
import {
  closeActiveBridge,
  openExternalSafely,
  runBannerCleanup,
  showCopyLinkBanner
} from '../firebaseBridge/flowState'
import { detectFirebaseEnv, getFirebaseConfig } from '../firebaseBridge/config'
import { abortableSleep } from '../firebaseBridge/flowControl'
import {
  bindSignedInUser,
  emitSignInFailure,
  type HandleFirebasePopupOpts,
  POST_SIGNIN_HOLD_MS
} from '../firebaseBridge/flowShared'
import { buildIndexedDbInjectScript } from '../firebaseBridge/inject'
import { extractProviderId } from '../firebaseBridge/intercept'
import { restoreParentWindow } from '../firebaseBridge/restoreParentWindow'
import { getDeviceId } from '../../lib/deviceId'
import * as mainTelemetry from '../../lib/telemetry'
import * as settings from '../../settings'

/** Budget for the code-create POST; past this the legacy bridge takes over. */
const CREATE_CODE_TIMEOUT_MS = 8000

/** Random 0-500ms added to each poll so a fleet of desktops doesn't sync-poll. */
const POLL_JITTER_MS = 500

/** Cloud currently keeps a redeemed grant exchangeable for this long. */
const POST_REDEEM_RETRY_GRACE_MS = 120_000

const DESKTOP_LOGIN_CODE_FLOW = 'desktop_login_code'

/**
 * In-flight flow, aborted on re-entry (mirror of firebaseBridge's
 * `activeBridgeFlow`): if the user clicks Sign in again while a previous
 * attempt is still parked on an open browser tab, the stale poll loop is
 * cancelled before the new one starts.
 */
let activeFlow: AbortController | null = null

function cancelActiveFlow(): void {
  activeFlow?.abort()
  activeFlow = null
}

/**
 * Sign in through the Cloud login page with a short-lived desktop login
 * code (GTM-93): mint a PKCE-bound code on the backend, open the system
 * browser at the real Cloud login page carrying only the opaque code,
 * poll the exchange endpoint until the signed-in browser session redeems
 * it, then finish with the one-time Firebase custom token — no loopback
 * server, and the web/desktop identities get stitched server-side.
 *
 * Returns 'fallback' only when the flow died before the browser opened
 * (dev-project auth against the prod Cloud origin, backend without the
 * endpoints, network trouble, timeout) — the caller
 * then runs the legacy loopback bridge transparently. After the browser
 * has opened, failures surface via sign_in_failed + onError and resolve
 * 'handled': restarting the legacy bridge would fight the login tab the
 * user may be halfway through.
 */
export async function signInViaDesktopLoginCode(
  interceptedAuthUrl: string,
  comfyContents: WebContents,
  opts: HandleFirebasePopupOpts = {}
): Promise<'handled' | 'fallback'> {
  const firebaseEnv = detectFirebaseEnv(interceptedAuthUrl)
  const cloudOrigin = cloudLoginOriginForUrl(
    comfyContents.getURL(),
    firebaseEnv === 'dev' && !app.isPackaged
  )
  // The Cloud origin's backend mints custom tokens for its own Firebase
  // project. A dev-project auth URL against the production origin would
  // mint a PROD token the dev project rejects — only a loopback dev origin
  // (whose /api fronts a matching dev backend) can serve the dev flow, so
  // anything else hands off to the legacy loopback bridge.
  if (firebaseEnv === 'dev' && cloudOrigin === CLOUD_LOGIN_ORIGIN) {
    cancelActiveFlow()
    runBannerCleanup()
    closeActiveBridge()
    return 'fallback'
  }

  cancelActiveFlow()
  const controller = new AbortController()
  activeFlow = controller
  // Clear a prior attempt's "copy link" card so this attempt doesn't
  // stack a second one, and kill any stale legacy loopback bridge so it
  // can't complete a competing sign-in underneath this flow (same hygiene
  // as the legacy bridge path).
  runBannerCleanup()
  closeActiveBridge()

  // The Cloud page owns provider choice when Firebase omitted or supplied an
  // unsupported providerId, so keep that widened path visible in the funnel.
  const provider = extractProviderId(interceptedAuthUrl) ?? 'cloud'
  const firebaseConfig = getFirebaseConfig(firebaseEnv)
  const codeVerifier = createCodeVerifier()

  const request: CreateDesktopLoginCodeRequest = {
    platform: process.platform,
    app_version: app.getVersion(),
    code_challenge: codeChallengeS256(codeVerifier)
  }
  // installation_id enables the web->desktop identity stitch. Consent-gated
  // like every other telemetry write ('undecided' omits too); the auth
  // handoff itself works without it.
  if (settings.get('telemetryEnabled') === true) {
    request.installation_id = getDeviceId()
  }

  let grant: DesktopLoginCodeGrant
  try {
    grant = await createDesktopLoginCode(cloudOrigin, request, {
      signal: controller.signal,
      timeoutMs: CREATE_CODE_TIMEOUT_MS
    })
  } catch {
    // Backend without the endpoint (404), network trouble, or timeout —
    // the browser never opened, so the legacy bridge can take over
    // transparently and emit its own funnel events. A superseded attempt
    // reports 'handled' instead so the caller doesn't start a second
    // sign-in underneath the newer one.
    if (activeFlow === controller) activeFlow = null
    return controller.signal.aborted || comfyContents.isDestroyed() ? 'handled' : 'fallback'
  }
  if (controller.signal.aborted || comfyContents.isDestroyed()) {
    if (activeFlow === controller) activeFlow = null
    return 'handled'
  }

  // Same funnel entry as the legacy bridge; `flow` splits the two sign-in
  // mechanisms apart in analytics. Emitted only once the code exists —
  // just before the browser opens — so a create-failure fallback doesn't
  // double-count with the legacy path's own started event.
  mainTelemetry.capture('comfy.desktop.auth.sign_in_started', {
    provider,
    flow: DESKTOP_LOGIN_CODE_FLOW
  })

  let retriedPollErrors = 0
  try {
    // Only the opaque one-time code transits the browser — never
    // installation_id or any auth material.
    const loginUrl = new URL('/cloud/login', cloudOrigin)
    loginUrl.searchParams.set('desktop_login_code', grant.code)
    openExternalSafely(loginUrl.href)
    showCopyLinkBanner(comfyContents, loginUrl.href)

    const deadlineMs = Date.now() + grant.expires_in * 1000
    const retryDeadlineMs = deadlineMs + POST_REDEEM_RETRY_GRACE_MS
    let customToken: string | null = null
    while (customToken === null) {
      await abortableSleep(
        grant.poll_interval * 1000 + Math.floor(Math.random() * POLL_JITTER_MS),
        controller.signal
      )
      if (comfyContents.isDestroyed()) {
        controller.abort()
        return 'handled'
      }
      // Past the original deadline, a pending result means the code expired.
      // A redeem in the last poll interval can still be exchangeable because
      // Cloud keeps a 120s post-redeem window; bounded transport/mint failures
      // therefore keep retrying through that grace period.
      const pastCodeDeadline = Date.now() >= deadlineMs
      try {
        const exchange = await exchangeDesktopLoginCode(
          cloudOrigin,
          { code: grant.code, code_verifier: codeVerifier },
          { signal: controller.signal }
        )
        if (exchange.status === 'complete') customToken = exchange.custom_token
      } catch (err) {
        // Transient server/network hiccups may clear up within the code's
        // TTL. A redeem near expiry extends Cloud's exchange window, so keep
        // retrying bounded failures through that grace period; terminal
        // verdicts (403/404) still stop immediately.
        if (Date.now() < retryDeadlineMs && err instanceof DesktopLoginCodeError && err.retryable) {
          retriedPollErrors += 1
          continue
        }
        throw err
      }
      if (customToken === null && pastCodeDeadline) {
        throw new Error('desktop login code expired before sign-in completed')
      }
    }
    // A re-click may supersede this flow at any await from here on —
    // check before every await/side-effect so a stale flow never signs
    // in, injects a user, or steals focus underneath the newer one.
    if (controller.signal.aborted) return 'handled'
    if (comfyContents.isDestroyed()) {
      controller.abort()
      return 'handled'
    }

    const signIn = await signInWithCustomToken(firebaseConfig.apiKey, customToken, {
      signal: controller.signal
    })
    if (controller.signal.aborted) return 'handled'
    const account = await lookupAccount(firebaseConfig.apiKey, signIn.idToken, {
      signal: controller.signal
    })
    if (controller.signal.aborted) return 'handled'
    const user = buildPersistedUserFromCustomToken(firebaseConfig, signIn, account)
    // Same identity hook as the legacy bridge (consent-gated downstream),
    // bound before the reload below so the merge survives a teardown.
    bindSignedInUser(user)
    // Desktop half of the GTM-93 stitch — mirrors the backend's
    // comfy.cloud.identity.login_attributed emitted at redeem time.
    mainTelemetry.capture('comfy.desktop.identity.login_attributed', {
      via: 'desktop_login_code'
    })
    if (comfyContents.isDestroyed()) return 'handled'
    // Same hold as the legacy bridge: let the user see the browser's
    // signed-in state before Desktop pulls focus back. Abort-aware — a
    // re-click during the hold rejects into the catch below as 'handled'.
    await abortableSleep(POST_SIGNIN_HOLD_MS, controller.signal)
    if (controller.signal.aborted || comfyContents.isDestroyed()) return 'handled'
    await comfyContents.executeJavaScript(
      buildIndexedDbInjectScript(user, firebaseConfig.apiKey),
      true
    )
    if (controller.signal.aborted) return 'handled'
    restoreParentWindow(opts.parentWindow)
    return 'handled'
  } catch (err) {
    // A superseded attempt isn't a failure — the newer one owns the UX.
    if (controller.signal.aborted) return 'handled'
    const error = err instanceof Error ? err : new Error(String(err))
    const failure = emitSignInFailure(provider, DESKTOP_LOGIN_CODE_FLOW, error, {
      retried_poll_errors: retriedPollErrors
    })
    opts.onError?.(failure)
    return 'handled'
  } finally {
    // Capture ownership before nulling: a superseded flow finishing late
    // must not tear down the banner the newer flow just put up.
    const ownsUx = activeFlow === controller
    if (ownsUx) {
      activeFlow = null
      runBannerCleanup()
    }
  }
}
