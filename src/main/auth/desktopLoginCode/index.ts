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
  isOnOrigin,
  originOf
} from '../firebaseBridge/flowShared'
import {
  beginFirebaseSessionInjection,
  injectFirebaseSession,
  releaseFirebaseSessionInjection
} from '../firebaseBridge/inject'
import { extractProviderId } from '../firebaseBridge/intercept'
import { restoreParentWindow } from '../firebaseBridge/restoreParentWindow'
import { getDeviceId } from '../../lib/deviceId'
import * as mainTelemetry from '../../lib/telemetry'
import * as settings from '../../settings'

const CREATE_CODE_TIMEOUT_MS = 8000

const POLL_JITTER_MS = 500

const LOGIN_CODE_POST_SIGNIN_HOLD_MS = 500

const POST_REDEEM_RETRY_GRACE_MS = 120_000

const DESKTOP_LOGIN_CODE_FLOW = 'desktop_login_code'

let activeFlow: AbortController | null = null

function cancelActiveFlow(): void {
  activeFlow?.abort()
  activeFlow = null
}

export async function signInViaDesktopLoginCode(
  interceptedAuthUrl: string,
  comfyContents: WebContents,
  opts: HandleFirebasePopupOpts = {}
): Promise<'handled' | 'fallback'> {
  const sessionTargetOrigin = originOf(comfyContents.getURL())
  const firebaseEnv = detectFirebaseEnv(interceptedAuthUrl)
  const cloudOrigin = cloudLoginOriginForUrl(
    comfyContents.getURL(),
    firebaseEnv === 'dev' && !app.isPackaged
  )
  if (firebaseEnv === 'dev' && cloudOrigin === CLOUD_LOGIN_ORIGIN) {
    cancelActiveFlow()
    runBannerCleanup()
    closeActiveBridge()
    return 'fallback'
  }

  cancelActiveFlow()
  const controller = new AbortController()
  activeFlow = controller
  runBannerCleanup()
  closeActiveBridge()
  const sessionInjection = beginFirebaseSessionInjection(comfyContents)

  const provider = extractProviderId(interceptedAuthUrl) ?? 'cloud'
  const firebaseConfig = getFirebaseConfig(firebaseEnv)
  const codeVerifier = createCodeVerifier()

  const request: CreateDesktopLoginCodeRequest = {
    platform: process.platform,
    app_version: app.getVersion(),
    code_challenge: codeChallengeS256(codeVerifier)
  }
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
    if (activeFlow === controller) activeFlow = null
    releaseFirebaseSessionInjection(sessionInjection)
    return controller.signal.aborted || comfyContents.isDestroyed() ? 'handled' : 'fallback'
  }
  if (controller.signal.aborted || comfyContents.isDestroyed()) {
    if (activeFlow === controller) activeFlow = null
    releaseFirebaseSessionInjection(sessionInjection)
    return 'handled'
  }

  mainTelemetry.capture('comfy.desktop.auth.sign_in_started', {
    provider,
    flow: DESKTOP_LOGIN_CODE_FLOW
  })

  let retriedPollErrors = 0
  try {
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
      const pastCodeDeadline = Date.now() >= deadlineMs
      try {
        const exchange = await exchangeDesktopLoginCode(
          cloudOrigin,
          { code: grant.code, code_verifier: codeVerifier },
          { signal: controller.signal }
        )
        if (exchange.status === 'complete') customToken = exchange.custom_token
      } catch (err) {
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
    if (comfyContents.isDestroyed()) return 'handled'
    await abortableSleep(LOGIN_CODE_POST_SIGNIN_HOLD_MS, controller.signal)
    if (controller.signal.aborted || comfyContents.isDestroyed()) return 'handled'
    if (!sessionTargetOrigin || !isOnOrigin(comfyContents, sessionTargetOrigin)) {
      throw new Error('embedded view changed origin before session injection')
    }
    const injected = await injectFirebaseSession(
      sessionInjection,
      sessionTargetOrigin,
      user,
      firebaseConfig.apiKey
    )
    if (!injected) return 'handled'
    if (controller.signal.aborted) return 'handled'
    bindSignedInUser(user, comfyContents, { via: 'desktop_login_code' })
    restoreParentWindow(opts.parentWindow)
    return 'handled'
  } catch (err) {
    if (controller.signal.aborted) return 'handled'
    const error = err instanceof Error ? err : new Error(String(err))
    const failure = emitSignInFailure(provider, DESKTOP_LOGIN_CODE_FLOW, error, {
      retried_poll_errors: retriedPollErrors
    })
    opts.onError?.(failure)
    return 'handled'
  } finally {
    const ownsUx = activeFlow === controller
    if (ownsUx) {
      activeFlow = null
      runBannerCleanup()
    }
    releaseFirebaseSessionInjection(sessionInjection)
  }
}
