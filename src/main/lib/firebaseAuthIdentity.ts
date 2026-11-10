import type { WebContents } from 'electron'
import type { ComfyDesktop2FirebaseAuthState } from '../../types/comfyDesktopBridge'
import * as mainTelemetry from './telemetry'
import { normalizePostHogUserId } from './opaqueIdentifier'
import { isTrustedCloudUrl } from './trustedCloudUrl'
import {
  clearVerifiedLocalFirebaseUser,
  isLoopbackOrigin,
  persistVerifiedLocalFirebaseUser,
  readVerifiedLocalFirebaseUser
} from './verifiedLocalFirebaseAuth'

interface Reporter {
  eligible: boolean
  active: boolean
  pendingExpired: boolean
  localReportingAuthorized: boolean
  localExpectedUserId: string | null
  signedInOrigin: string | null
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

interface MainVerifiedAuthState {
  userId: string
  origin: string
  properties: Record<string, mainTelemetry.TelemetryValue>
  propertiesApplied: boolean
  reportedState?: ComfyDesktop2FirebaseAuthState
  rendererMayReaffirm: boolean
}

export type FirebaseIdentityConsensus =
  | { status: 'unknown' }
  | { status: 'pending' }
  | { status: 'signed_out'; observed: boolean }
  | { status: 'conflicted' }
  | { status: 'signed_in'; userId: string }

const reporters = new Map<WebContents, Reporter>()
const mainVerifiedStates = new Map<WebContents, MainVerifiedAuthState>()
let consensus: FirebaseIdentityConsensus = { status: 'unknown' }
let signOutWitnessed = false
const consensusObservers = new Set<(consensus: FirebaseIdentityConsensus) => void>()
let requestedUserId: string | null = null
let anonymousEpochIsUnmergeable = false
let persistedEpochStateLoaded = false
let epochTaintIsDurable = true
export const PENDING_CONSENSUS_DEADLINE_MS = 60_000
let pendingConsensusDeadline: ReturnType<typeof setTimeout> | null = null

function sameConsensus(
  first: FirebaseIdentityConsensus,
  second: FirebaseIdentityConsensus
): boolean {
  if (first.status !== second.status) return false
  if (first.status === 'signed_out') {
    return first.observed === (second as { observed: boolean }).observed
  }
  return first.status !== 'signed_in' || first.userId === (second as { userId: string }).userId
}

function publishConsensus(next: FirebaseIdentityConsensus): void {
  if (sameConsensus(consensus, next)) return
  consensus = next
  for (const observe of [...consensusObservers]) {
    if (!sameConsensus(consensus, next)) return
    try {
      observe(next)
    } catch (err) {
      console.log('[firebase-identity] consensus observer failed:', err)
    }
  }
}

export function getFirebaseIdentityConsensus(): FirebaseIdentityConsensus {
  return consensus
}

export function observeFirebaseIdentityConsensus(
  observe: (consensus: FirebaseIdentityConsensus) => void
): () => void {
  consensusObservers.add(observe)
  return () => consensusObservers.delete(observe)
}

export function viewsReportingFirebaseUser(userId: string): WebContents[] {
  const views: WebContents[] = []
  for (const [webContents, reporter] of reporters) {
    if (webContents.isDestroyed() || !reporter.active) continue
    if (reporter.state.status === 'signed_in' && reporter.state.userId === userId) {
      views.push(webContents)
    }
  }
  for (const [webContents, state] of mainVerifiedStates) {
    if (webContents.isDestroyed() || state.userId !== userId) continue
    if (originOf(webContents.getURL()) !== state.origin) continue
    if (!views.includes(webContents)) views.push(webContents)
  }
  return views
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function localExpectedUserIdForUrl(url: string): string | null {
  const origin = originOf(url)
  return origin && isLoopbackOrigin(origin) ? readVerifiedLocalFirebaseUser(origin) : null
}

function refreshReporterAuthScope(reporter: Reporter, url: string): boolean {
  const expectedUserId = localExpectedUserIdForUrl(url)
  reporter.localExpectedUserId = expectedUserId
  reporter.localReportingAuthorized = expectedUserId !== null
  return isTrustedCloudUrl(url) || reporter.localReportingAuthorized
}

function revokeAcceptedLocalAuthorization(
  webContents: WebContents,
  reporter: Reporter,
  origin: string | null,
  observedSignOut: boolean,
  userMismatch: boolean
): void {
  if (!origin || !isLoopbackOrigin(origin) || (!observedSignOut && !userMismatch)) return
  clearVerifiedLocalFirebaseUser(origin)
  reporter.localReportingAuthorized = false
  reporter.localExpectedUserId = null
  mainVerifiedStates.delete(webContents)
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

function clearPendingConsensusDeadline(): void {
  if (pendingConsensusDeadline === null) return
  clearTimeout(pendingConsensusDeadline)
  pendingConsensusDeadline = null
}

function markExpiredPendingContributors(): void {
  for (const [webContents, reporter] of reporters) {
    if (webContents.isDestroyed()) continue
    const navigationPending =
      reporter.awaitingCommittedFrame || reporter.mainFrameNavigationsInFlight > 0
    const contributesPending = reporter.active
      ? reporter.state.status === 'pending'
      : navigationPending && mainVerifiedStates.has(webContents)
    if (contributesPending) reporter.pendingExpired = true
  }
}

function detachToAnonymousIdentity(): void {
  clearPendingConsensusDeadline()
  requestedUserId = null
  mainTelemetry.applyFirebaseAnonymousConsensus()
}

function requestAnonymousIdentity(): void {
  if (requestedUserId === null) return
  detachToAnonymousIdentity()
}

function requestPendingIdentity(): void {
  if (requestedUserId === null) return
  mainTelemetry.applyFirebasePendingConsensus()
  if (pendingConsensusDeadline === null) {
    pendingConsensusDeadline = setTimeout(() => {
      pendingConsensusDeadline = null
      markExpiredPendingContributors()
      reconcile()
      if (pendingConsensusDeadline === null && mainTelemetry.isFirebaseConsensusPending()) {
        mainTelemetry.releaseFirebasePendingConsensus()
        mainTelemetry.capture('comfy.desktop.identity.pending_consensus_expired')
      }
    }, PENDING_CONSENSUS_DEADLINE_MS)
    pendingConsensusDeadline.unref()
  }
}

function requestConflictedIdentity(): void {
  const wasAlreadyTainted = anonymousEpochIsUnmergeable
  detachToAnonymousIdentity()
  anonymousEpochIsUnmergeable = true
  if (!wasAlreadyTainted || !epochTaintIsDurable) {
    epochTaintIsDurable = mainTelemetry.markAnonymousEpochUnmergeable()
    if (!epochTaintIsDurable && !wasAlreadyTainted) {
      epochTaintIsDurable = mainTelemetry.discardUnmergeableAnonymousEpoch()
    }
  }
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

export function bindMainVerifiedFirebaseUser(
  userId: string,
  properties: Record<string, mainTelemetry.TelemetryValue> = {},
  source: WebContents,
  attribution: mainTelemetry.TelemetryContext | null = null
): void {
  const normalizedUserId = normalizePostHogUserId(userId)
  if (!normalizedUserId) return
  if (attribution) mainTelemetry.stageLoginAttribution(normalizedUserId, attribution)
  loadPersistedEpochState()
  const origin = originOf(source.getURL())
  if (!origin) return
  trackFirebaseAuthReporter(source)
  const reporter = reporters.get(source)
  if (!reporter?.eligible) return
  const staleSnapshotUnlessAffirming = (snapshot: ReporterFrameState | null): void => {
    if (!snapshot) return
    if (snapshot.state.status === 'signed_in' && snapshot.state.userId === normalizedUserId) return
    snapshot.state = { status: 'pending' }
  }
  if (isLoopbackOrigin(origin)) {
    if (!persistVerifiedLocalFirebaseUser(origin, normalizedUserId)) {
      return
    }
    reporter.localReportingAuthorized = true
    reporter.localExpectedUserId = normalizedUserId
    reporter.signedInOrigin = origin
    reporter.active = true
    reporter.state = { status: 'pending' }
    staleSnapshotUnlessAffirming(reporter.recoverableState)
    staleSnapshotUnlessAffirming(reporter.committedCandidate)
  } else if (isTrustedCloudUrl(source.getURL())) {
    reporter.signedInOrigin = origin
    if (reporter.state.status !== 'signed_in' || reporter.state.userId !== normalizedUserId) {
      reporter.state = { status: 'pending' }
    }
    staleSnapshotUnlessAffirming(reporter.recoverableState)
    staleSnapshotUnlessAffirming(reporter.committedCandidate)
  }
  mainVerifiedStates.set(source, {
    userId: normalizedUserId,
    origin,
    properties,
    propertiesApplied: false,
    rendererMayReaffirm: true
  })
  reconcile()
}

function reconcile(): void {
  let expiredPendingContributors = 0
  const activeReporterStates: ComfyDesktop2FirebaseAuthState[] = []
  for (const [webContents, reporter] of reporters) {
    if (webContents.isDestroyed() || !reporter.active) continue
    if (reporter.state.status !== 'pending') {
      reporter.pendingExpired = false
    } else if (reporter.pendingExpired) {
      expiredPendingContributors += 1
      continue
    }
    activeReporterStates.push(reporter.state)
  }
  const mainCandidates: Array<{
    webContents: WebContents
    state: MainVerifiedAuthState
    contributes: boolean
    contributionState: ComfyDesktop2FirebaseAuthState
  }> = []
  for (const [webContents, state] of mainVerifiedStates) {
    if (webContents.isDestroyed() || originOf(webContents.getURL()) !== state.origin) {
      mainVerifiedStates.delete(webContents)
      continue
    }
    const reporter = reporters.get(webContents)
    if (
      reporter?.active &&
      reporter.state.status !== 'pending' &&
      (reporter.state.status !== 'signed_in' || reporter.state.userId !== state.userId)
    ) {
      mainVerifiedStates.delete(webContents)
      continue
    }
    const navigationPending =
      reporter?.awaitingCommittedFrame || (reporter?.mainFrameNavigationsInFlight ?? 0) > 0
    if (reporter && !reporter.active && reporter.pendingExpired && !navigationPending) {
      reporter.pendingExpired = false
    }
    const expiredNavigation = navigationPending === true && reporter?.pendingExpired === true
    if (expiredNavigation) expiredPendingContributors += 1
    mainCandidates.push({
      webContents,
      state,
      contributes: !reporter?.active && !expiredNavigation,
      contributionState: navigationPending
        ? { status: 'pending' }
        : (state.reportedState ?? { status: 'signed_in', userId: state.userId })
    })
  }
  const states: ComfyDesktop2FirebaseAuthState[] = [
    ...activeReporterStates,
    ...mainCandidates
      .filter(({ contributes }) => contributes)
      .map(({ contributionState }) => contributionState)
  ]

  if (states.length === 0) {
    if (expiredPendingContributors > 0) return
    requestAnonymousIdentity()
    publishConsensus({ status: 'unknown' })
    return
  }

  if (states.some((state) => state.status === 'pending')) {
    requestPendingIdentity()
    publishConsensus({ status: 'pending' })
    return
  }

  const signedIn = states.filter(
    (state): state is Extract<ComfyDesktop2FirebaseAuthState, { status: 'signed_in' }> =>
      state.status === 'signed_in'
  )

  if (signedIn.length === 0) {
    detachToAnonymousIdentity()
    clearUnmergeableEpoch()
    publishConsensus({ status: 'signed_out', observed: signOutWitnessed })
    return
  }

  const userIds = new Set(signedIn.map((state) => state.userId))
  const hasConflict = signedIn.length !== states.length || userIds.size !== 1
  if (hasConflict) {
    requestConflictedIdentity()
    publishConsensus({ status: 'conflicted' })
    return
  }

  const userId = signedIn[0]!.userId
  if (!clearUnmergeableEpoch()) return

  clearPendingConsensusDeadline()
  requestedUserId = userId
  signOutWitnessed = false
  publishConsensus({ status: 'signed_in', userId })
  const confirmedMainStates = mainCandidates.filter(({ webContents, state, contributes }) => {
    if (state.userId !== userId) return false
    if (contributes) return true
    const reporterState = reporters.get(webContents)?.state
    return reporterState?.status === 'signed_in' && reporterState.userId === userId
  })
  const unappliedMainStates = confirmedMainStates.filter(({ state }) => !state.propertiesApplied)
  if (unappliedMainStates.length > 0) {
    const properties = Object.assign(
      {},
      ...unappliedMainStates.map(({ state }) => state.properties)
    ) as Record<string, mainTelemetry.TelemetryValue>
    mainTelemetry.bindUserId(userId, properties)
    for (const { webContents, state, contributes } of unappliedMainStates) {
      state.propertiesApplied = true
      if (!contributes) mainVerifiedStates.delete(webContents)
    }
  } else {
    mainTelemetry.applyFirebaseUserConsensus(userId)
  }
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
    reporter.awaitingCommittedFrame = true
    reporter.committedFrame = null
    reporter.active = reporter.eligible && refreshReporterAuthScope(reporter, webContents.getURL())
    reporter.state = { status: 'pending' }
  }
  reporter.committedCandidate = null
  reporter.recoverableState = null
  reconcile()
}

function isAcceptedFallbackFrame(
  webContents: WebContents,
  reporter: Reporter,
  frame: FirebaseAuthFrameIdentity
): boolean {
  if (!isSameFrame(frame, currentMainFrame(webContents))) return false
  if (
    !reporter.awaitingCommittedFrame &&
    reporter.mainFrameNavigationsInFlight === 0 &&
    isSameFrame(reporter.committedFrame, frame)
  ) {
    return true
  }
  return (
    isSameFrame(reporter.recoverableState?.frame ?? null, frame) ||
    isSameFrame(reporter.committedCandidate?.frame ?? null, frame)
  )
}

export function trackFirebaseAuthReporter(webContents: WebContents): void {
  if (reporters.has(webContents) || webContents.isDestroyed()) return

  const reporter: Reporter = {
    eligible: false,
    active: false,
    pendingExpired: false,
    localReportingAuthorized: false,
    localExpectedUserId: null,
    signedInOrigin: null,
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
      reporter.provisionalFailureTerminals.clear()
      if (reporter.mainFrameNavigationsInFlight > 0) {
        reporter.mainFrameNavigationsInFlight -= 1
      }
      const authScopeIsActive = refreshReporterAuthScope(reporter, url)
      reporter.committedCandidate = {
        frame: {
          processId: frameProcessId,
          routingId: frameRoutingId
        },
        active: reporter.eligible && authScopeIsActive,
        state: { status: 'pending' }
      }
      reporter.committedFrame = reporter.committedCandidate.frame
      reporter.active = reporter.committedCandidate.active
      reporter.state = { status: 'pending' }
      reporter.recoverableState = null
      const mainVerifiedState = mainVerifiedStates.get(webContents)
      if (mainVerifiedState) mainVerifiedState.reportedState = { status: 'pending' }
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
      if (errorCode !== -3) {
        const key = failureTerminalKey(errorCode, validatedURL, frameProcessId, frameRoutingId)
        const existing = reporter.provisionalFailureTerminals.get(key) ?? 0
        reporter.provisionalFailureTerminals.set(key, existing + 1)
      }
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
      if (errorCode === -3) return
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
      mainVerifiedStates.delete(webContents)
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

export function activateFirebaseAuthReporter(webContents: WebContents): void {
  loadPersistedEpochState()
  trackFirebaseAuthReporter(webContents)
  const reporter = reporters.get(webContents)
  if (!reporter) return
  reporter.eligible = true
  reporter.pendingExpired = false
  reporter.awaitingCommittedFrame = true
  reporter.committedFrame = null
  reporter.recoverableState = null
  reporter.committedCandidate = null
  reporter.active = refreshReporterAuthScope(reporter, webContents.getURL())
  reporter.state = { status: 'pending' }
  reconcile()
}

export function deactivateFirebaseAuthReporter(webContents: WebContents): void {
  const reporter = reporters.get(webContents)
  if (!reporter) return
  reporter.eligible = false
  reporter.active = false
  reporter.state = { status: 'pending' }
  mainVerifiedStates.delete(webContents)
  reconcile()
}

export function reportFirebaseAuthState(
  webContents: WebContents,
  frame: FirebaseAuthFrameIdentity,
  state: ComfyDesktop2FirebaseAuthState
): void {
  trackFirebaseAuthReporter(webContents)
  const reporter = reporters.get(webContents)
  if (!reporter?.eligible) return
  const currentOrigin = originOf(webContents.getURL())
  const trustedCloud = isTrustedCloudUrl(webContents.getURL())
  const trustedLocal =
    currentOrigin !== null && isLoopbackOrigin(currentOrigin) && reporter.localReportingAuthorized
  if (!trustedCloud && !trustedLocal) {
    const mainVerifiedState = mainVerifiedStates.get(webContents)
    if (
      !mainVerifiedState ||
      currentOrigin !== mainVerifiedState.origin ||
      !mainVerifiedState.rendererMayReaffirm ||
      !isAcceptedFallbackFrame(webContents, reporter, frame)
    ) {
      return
    }
    const userMismatch = state.status === 'signed_in' && state.userId !== mainVerifiedState.userId
    mainVerifiedState.reportedState = userMismatch ? { status: 'pending' } : state
    if (userMismatch || state.status === 'signed_out') {
      mainVerifiedState.rendererMayReaffirm = false
    }
    if (state.status === 'signed_out') signOutWitnessed = true
    if (userMismatch) requestAnonymousIdentity()
    reconcile()
    return
  }
  const localUserMismatch =
    trustedLocal && state.status === 'signed_in' && state.userId !== reporter.localExpectedUserId
  const acceptedState: ComfyDesktop2FirebaseAuthState = localUserMismatch
    ? { status: 'pending' }
    : state
  const acceptReport = (): void => {
    if (acceptedState.status === 'signed_in') reporter.signedInOrigin = currentOrigin
    const observedSignOut =
      acceptedState.status === 'signed_out' && reporter.signedInOrigin === currentOrigin
    if (observedSignOut) {
      signOutWitnessed = true
      reporter.signedInOrigin = null
    }
    if (localUserMismatch) requestAnonymousIdentity()
    revokeAcceptedLocalAuthorization(
      webContents,
      reporter,
      currentOrigin,
      observedSignOut,
      localUserMismatch
    )
  }
  const candidate = reporter.committedCandidate
  if (candidate && isSameFrame(candidate.frame, frame)) {
    acceptReport()
    candidate.state = acceptedState
    return
  }
  const recoverable = reporter.recoverableState
  if (
    recoverable &&
    isSameFrame(recoverable.frame, frame) &&
    isSameFrame(recoverable.frame, currentMainFrame(webContents))
  ) {
    acceptReport()
    recoverable.state = acceptedState
    return
  }
  if (
    reporter.awaitingCommittedFrame ||
    reporter.mainFrameNavigationsInFlight > 0 ||
    !isSameFrame(reporter.committedFrame, frame)
  )
    return
  acceptReport()
  reporter.active = true
  reporter.state = acceptedState
  reconcile()
}

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
  mainVerifiedStates.clear()
  consensus = { status: 'unknown' }
  signOutWitnessed = false
  consensusObservers.clear()
  clearPendingConsensusDeadline()
  requestedUserId = null
  anonymousEpochIsUnmergeable = false
  persistedEpochStateLoaded = false
  epochTaintIsDurable = true
}
