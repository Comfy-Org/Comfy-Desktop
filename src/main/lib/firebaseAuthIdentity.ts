import type { WebContents } from 'electron'
import type { ComfyDesktop2FirebaseAuthState } from '../../types/comfyDesktopBridge'
import * as mainTelemetry from './telemetry'
import { isIllegalPostHogDistinctId, normalizeOpaqueIdentifier } from './opaqueIdentifier'
import { parseTrustedCloudUrl } from './trustedCloudUrl'

interface Reporter {
  eligible: boolean
  active: boolean
  awaitingCommittedFrame: boolean
  mainFrameNavigationsInFlight: number
  provisionalFailureTerminals: Map<string, number>
  committedFrame: FirebaseAuthFrameIdentity | null
  recoverableState: ReporterFrameState | null
  committedCandidate: ReporterFrameState | null
  state: ComfyDesktop2FirebaseAuthState
  onDidStartNavigation: (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
  ) => void
  onDidFrameNavigate: (
    event: Electron.Event,
    url: string,
    httpResponseCode: number,
    httpStatusText: string,
    isMainFrame: boolean,
    frameProcessId: number,
    frameRoutingId: number
  ) => void
  onDidFailProvisionalLoad: (
    event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
    frameProcessId: number,
    frameRoutingId: number
  ) => void
  onDidFailLoad: (
    event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
    frameProcessId: number,
    frameRoutingId: number
  ) => void
  onDestroyed: () => void
}

export interface FirebaseAuthFrameIdentity {
  processId: number
  routingId: number
}

interface ReporterFrameState {
  frame: FirebaseAuthFrameIdentity
  active: boolean
  state: ComfyDesktop2FirebaseAuthState
}

const reporters = new Map<WebContents, Reporter>()
let requestedUserId: string | null = null
let anonymousEpochIsUnmergeable = false
let persistedEpochStateLoaded = false
let epochTaintIsDurable = true

function isTrustedCloudUrl(url: string): boolean {
  return parseTrustedCloudUrl(url) !== null
}

function isSameFrame(
  first: FirebaseAuthFrameIdentity | null,
  second: FirebaseAuthFrameIdentity
): boolean {
  return first?.processId === second.processId && first.routingId === second.routingId
}

function currentMainFrame(webContents: WebContents): FirebaseAuthFrameIdentity {
  return {
    processId: webContents.mainFrame.processId,
    routingId: webContents.mainFrame.routingId
  }
}

function failureTerminalKey(
  errorCode: number,
  validatedURL: string,
  frameProcessId: number,
  frameRoutingId: number
): string {
  return `${errorCode}\u0000${validatedURL}\u0000${frameProcessId}\u0000${frameRoutingId}`
}

function requestAnonymousIdentity(): void {
  if (requestedUserId === null) return
  requestedUserId = null
  mainTelemetry.applyFirebaseAnonymousConsensus()
}

function clearUnmergeableEpoch(): boolean {
  if (!anonymousEpochIsUnmergeable) return true
  requestAnonymousIdentity()
  if (!epochTaintIsDurable) {
    epochTaintIsDurable = mainTelemetry.markAnonymousEpochUnmergeable()
    if (!epochTaintIsDurable) return false
  }
  if (!mainTelemetry.discardUnmergeableAnonymousEpoch()) return false
  anonymousEpochIsUnmergeable = false
  epochTaintIsDurable = true
  return true
}

function loadPersistedEpochState(): void {
  if (persistedEpochStateLoaded) return
  persistedEpochStateLoaded = true
  anonymousEpochIsUnmergeable = mainTelemetry.hasUnmergeableAnonymousEpoch()
}

/**
 * Bind a user verified by Desktop's auth flow while keeping the declarative
 * renderer consensus authoritative once hosted views begin reporting.
 */
export function bindMainVerifiedFirebaseUser(
  userId: string,
  properties: Record<string, mainTelemetry.TelemetryValue> = {}
): void {
  const normalizedUserId = normalizeOpaqueIdentifier(userId, 256)
  if (!normalizedUserId || isIllegalPostHogDistinctId(normalizedUserId)) return
  loadPersistedEpochState()
  if (!clearUnmergeableEpoch()) return
  requestedUserId = normalizedUserId
  const hasActiveReporter = [...reporters.entries()].some(
    ([webContents, reporter]) => !webContents.isDestroyed() && reporter.active
  )
  if (hasActiveReporter) {
    // The injected page will report its restored Firebase user after reload.
    // Queue verified properties now, but let multi-view consensus perform the
    // only identity bind so navigation cannot cause a bind/unbind/rebind pair.
    mainTelemetry.registerPersonProperties(properties)
    return
  }
  mainTelemetry.bindUserId(normalizedUserId, properties)
}

function reconcile(): void {
  const states = [...reporters.entries()]
    .filter(([webContents, reporter]) => !webContents.isDestroyed() && reporter.active)
    .map(([, reporter]) => reporter.state)

  if (states.length === 0 || states.some((state) => state.status === 'pending')) {
    requestAnonymousIdentity()
    return
  }

  const signedIn = states.filter(
    (state): state is Extract<ComfyDesktop2FirebaseAuthState, { status: 'signed_in' }> =>
      state.status === 'signed_in'
  )

  if (signedIn.length === 0) {
    requestAnonymousIdentity()
    clearUnmergeableEpoch()
    return
  }

  const userIds = new Set(signedIn.map((state) => state.userId))
  const hasConflict = signedIn.length !== states.length || userIds.size !== 1
  if (hasConflict) {
    const wasAlreadyTainted = anonymousEpochIsUnmergeable
    requestedUserId = null
    mainTelemetry.applyFirebaseAnonymousConsensus()
    anonymousEpochIsUnmergeable = true
    if (!wasAlreadyTainted || !epochTaintIsDurable) {
      epochTaintIsDurable = mainTelemetry.markAnonymousEpochUnmergeable()
      if (!epochTaintIsDurable && !wasAlreadyTainted) {
        // The taint marker could not persist, so a restart would resurrect
        // the conflicted anonymous ID untainted. Durably replace the epoch
        // instead; attempted once per conflict episode to avoid rotation
        // churn while the views still disagree.
        epochTaintIsDurable = mainTelemetry.discardUnmergeableAnonymousEpoch()
      }
    }
    return
  }

  const userId = signedIn[0]!.userId
  if (!clearUnmergeableEpoch()) return

  requestedUserId = userId
  mainTelemetry.applyFirebaseUserConsensus(userId)
}

function settleFailedNavigation(webContents: WebContents, reporter: Reporter): void {
  if (reporter.mainFrameNavigationsInFlight === 0) return
  reporter.mainFrameNavigationsInFlight -= 1
  if (reporter.mainFrameNavigationsInFlight > 0) {
    reporter.state = { status: 'pending' }
    reconcile()
    return
  }

  const currentFrame = currentMainFrame(webContents)
  const retainedState = isSameFrame(reporter.committedCandidate?.frame ?? null, currentFrame)
    ? reporter.committedCandidate
    : isSameFrame(reporter.recoverableState?.frame ?? null, currentFrame)
      ? reporter.recoverableState
      : null
  if (retainedState) {
    reporter.awaitingCommittedFrame = false
    reporter.committedFrame = retainedState.frame
    reporter.active = reporter.eligible && retainedState.active
    reporter.state = retainedState.state
  } else {
    // A terminal without an attributable retained frame must not reopen stale
    // IPC. Keep a trusted current document in consensus as pending until a
    // later commit supplies an exact frame identity.
    reporter.awaitingCommittedFrame = true
    reporter.committedFrame = null
    reporter.active = reporter.eligible && isTrustedCloudUrl(webContents.getURL())
    reporter.state = { status: 'pending' }
  }
  reporter.committedCandidate = null
  reporter.recoverableState = null
  reconcile()
}

/** Track a hosted view before its first navigation so unresolved views count as pending. */
export function trackFirebaseAuthReporter(webContents: WebContents): void {
  if (reporters.has(webContents) || webContents.isDestroyed()) return

  const reporter: Reporter = {
    eligible: false,
    active: false,
    awaitingCommittedFrame: true,
    mainFrameNavigationsInFlight: 0,
    provisionalFailureTerminals: new Map(),
    committedFrame: null,
    recoverableState: null,
    committedCandidate: null,
    state: { status: 'pending' },
    onDidStartNavigation: (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      if (
        reporter.mainFrameNavigationsInFlight === 0 &&
        !reporter.awaitingCommittedFrame &&
        reporter.committedFrame
      ) {
        reporter.recoverableState = {
          frame: reporter.committedFrame,
          active: reporter.active,
          state: reporter.state
        }
        reporter.committedCandidate = null
      }
      reporter.mainFrameNavigationsInFlight += 1
      reporter.awaitingCommittedFrame = true
      // The requested destination is not the current document until commit.
      // Keep current-frame trust active, but gate consensus as pending.
      reporter.state = { status: 'pending' }
      reconcile()
    },
    onDidFrameNavigate: (
      _event,
      url,
      _httpResponseCode,
      _httpStatusText,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      if (!isMainFrame) return
      // Electron emits a provisional failure's paired `did-fail-load` before
      // the next main-frame commit (canceled loads never emit it at all), so
      // entries still recorded here are unpairable; drop them rather than let
      // canceled loads accumulate for the view's lifetime.
      reporter.provisionalFailureTerminals.clear()
      if (reporter.mainFrameNavigationsInFlight > 0) {
        reporter.mainFrameNavigationsInFlight -= 1
      }
      reporter.committedCandidate = {
        frame: {
          processId: frameProcessId,
          routingId: frameRoutingId
        },
        active: reporter.eligible && isTrustedCloudUrl(url),
        state: { status: 'pending' }
      }
      reporter.committedFrame = reporter.committedCandidate.frame
      reporter.active = reporter.committedCandidate.active
      reporter.state = { status: 'pending' }
      reporter.recoverableState = null
      if (reporter.mainFrameNavigationsInFlight > 0) {
        reconcile()
        return
      }
      reporter.awaitingCommittedFrame = false
      reporter.committedCandidate = null
      reconcile()
    },
    onDidFailProvisionalLoad: (
      _event,
      errorCode,
      _errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      if (!isMainFrame) return
      const key = failureTerminalKey(errorCode, validatedURL, frameProcessId, frameRoutingId)
      const existing = reporter.provisionalFailureTerminals.get(key) ?? 0
      reporter.provisionalFailureTerminals.set(key, existing + 1)
      settleFailedNavigation(webContents, reporter)
    },
    onDidFailLoad: (
      _event,
      errorCode,
      _errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      if (!isMainFrame) return
      const key = failureTerminalKey(errorCode, validatedURL, frameProcessId, frameRoutingId)
      const provisional = reporter.provisionalFailureTerminals.get(key)
      if (provisional !== undefined) {
        if (provisional === 1) reporter.provisionalFailureTerminals.delete(key)
        else reporter.provisionalFailureTerminals.set(key, provisional - 1)
        return
      }
      settleFailedNavigation(webContents, reporter)
    },
    onDestroyed: () => {
      reporters.delete(webContents)
      reconcile()
    }
  }

  reporters.set(webContents, reporter)
  webContents.on('did-start-navigation', reporter.onDidStartNavigation)
  webContents.on('did-frame-navigate', reporter.onDidFrameNavigate)
  webContents.on('did-fail-provisional-load', reporter.onDidFailProvisionalLoad)
  webContents.on('did-fail-load', reporter.onDidFailLoad)
  webContents.once('destroyed', reporter.onDestroyed)
  reconcile()
}

/** Make an attached installation's tracked view eligible to report auth. */
export function activateFirebaseAuthReporter(webContents: WebContents): void {
  loadPersistedEpochState()
  trackFirebaseAuthReporter(webContents)
  const reporter = reporters.get(webContents)
  if (!reporter) return
  reporter.eligible = true
  reporter.awaitingCommittedFrame = true
  reporter.committedFrame = null
  reporter.recoverableState = null
  reporter.committedCandidate = null
  reporter.active = isTrustedCloudUrl(webContents.getURL())
  reporter.state = { status: 'pending' }
  reconcile()
}

/** Exclude a retained view while its host is detached from an installation. */
export function deactivateFirebaseAuthReporter(webContents: WebContents): void {
  const reporter = reporters.get(webContents)
  if (!reporter) return
  reporter.eligible = false
  reporter.active = false
  reporter.state = { status: 'pending' }
  reconcile()
}

/** Record a trusted renderer's complete Firebase state and recompute consensus. */
export function reportFirebaseAuthState(
  webContents: WebContents,
  frame: FirebaseAuthFrameIdentity,
  state: ComfyDesktop2FirebaseAuthState
): void {
  trackFirebaseAuthReporter(webContents)
  const reporter = reporters.get(webContents)
  if (!reporter?.eligible || !isTrustedCloudUrl(webContents.getURL())) return
  const candidate = reporter.committedCandidate
  if (candidate && isSameFrame(candidate.frame, frame)) {
    candidate.state = state
    return
  }
  const recoverable = reporter.recoverableState
  if (
    recoverable &&
    isSameFrame(recoverable.frame, frame) &&
    isSameFrame(recoverable.frame, currentMainFrame(webContents))
  ) {
    recoverable.state = state
    return
  }
  if (
    reporter.awaitingCommittedFrame ||
    reporter.mainFrameNavigationsInFlight > 0 ||
    !isSameFrame(reporter.committedFrame, frame)
  )
    return
  reporter.active = true
  reporter.state = state
  reconcile()
}

/** @internal Reset process-global reporter state between tests. */
export function _resetForTest(): void {
  for (const [webContents, reporter] of reporters) {
    if (!webContents.isDestroyed()) {
      webContents.off('did-start-navigation', reporter.onDidStartNavigation)
      webContents.off('did-frame-navigate', reporter.onDidFrameNavigate)
      webContents.off('did-fail-provisional-load', reporter.onDidFailProvisionalLoad)
      webContents.off('did-fail-load', reporter.onDidFailLoad)
      webContents.off('destroyed', reporter.onDestroyed)
    }
  }
  reporters.clear()
  requestedUserId = null
  anonymousEpochIsUnmergeable = false
  persistedEpochStateLoaded = false
  epochTaintIsDurable = true
}
