import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const telemetry = vi.hoisted(() => ({
  applyFirebaseAnonymousConsensus: vi.fn(),
  applyFirebasePendingConsensus: vi.fn(),
  applyFirebaseUserConsensus: vi.fn(),
  bindUserId: vi.fn(),
  capture: vi.fn(),
  isFirebaseConsensusPending: vi.fn(() => true),
  registerPersonProperties: vi.fn(),
  releaseFirebasePendingConsensus: vi.fn(),
  stageLoginAttribution: vi.fn(),
  discardUnmergeableAnonymousEpoch: vi.fn(() => true),
  hasUnmergeableAnonymousEpoch: vi.fn(() => false),
  markAnonymousEpochUnmergeable: vi.fn(() => true)
}))

vi.mock('./telemetry', () => telemetry)

const verifiedLocalUsers = vi.hoisted(() => new Map<string, string>())
const verifiedLocalPersistence = vi.hoisted(() => ({ succeeds: true }))
vi.mock('./verifiedLocalFirebaseAuth', () => ({
  isLoopbackOrigin: (origin: string) => {
    try {
      const url = new URL(origin)
      return url.hostname === 'localhost' || url.hostname.startsWith('127.')
    } catch {
      return false
    }
  },
  readVerifiedLocalFirebaseUser: (origin: string) => verifiedLocalUsers.get(origin) ?? null,
  persistVerifiedLocalFirebaseUser: (origin: string, userId: string) => {
    if (!verifiedLocalPersistence.succeeds) return false
    verifiedLocalUsers.set(origin, userId)
    return true
  },
  clearVerifiedLocalFirebaseUser: (origin: string) => {
    verifiedLocalUsers.delete(origin)
    return true
  }
}))

import {
  _resetForTest,
  activateFirebaseAuthReporter,
  bindMainVerifiedFirebaseUser,
  deactivateFirebaseAuthReporter,
  getFirebaseIdentityConsensus,
  observeFirebaseIdentityConsensus,
  PENDING_CONSENSUS_DEADLINE_MS,
  reportFirebaseAuthState as recordFirebaseAuthState,
  trackFirebaseAuthReporter,
  viewsReportingFirebaseUser,
  type FirebaseIdentityConsensus
} from './firebaseAuthIdentity'

class FakeWebContents extends EventEmitter {
  private destroyed = false
  private loadingMainFrame = false
  private nextRoutingId = 1
  private currentMainFrame: {
    processId: number
    routingId: number
    url: string
  }

  constructor(url: string) {
    super()
    this.currentMainFrame = { processId: 100, routingId: this.nextRoutingId, url }
  }

  getURL(): string {
    return this.currentMainFrame.url
  }

  get mainFrame(): { processId: number; routingId: number; url: string } {
    return this.currentMainFrame
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  isLoadingMainFrame(): boolean {
    return this.loadingMainFrame
  }

  navigate(url: string, isInPlace = false, isMainFrame = true): void {
    this.startNavigation(url, isInPlace, isMainFrame)
    if (!isMainFrame) return
    if (isInPlace) {
      this.currentMainFrame = { ...this.currentMainFrame, url }
      return
    }
    this.commitNavigation(url)
  }

  startNavigation(url: string, isInPlace = false, isMainFrame = true): void {
    if (isMainFrame && !isInPlace) this.loadingMainFrame = true
    this.emit('did-start-navigation', {
      url,
      isSameDocument: isInPlace,
      isMainFrame,
      frame: isMainFrame ? this.currentMainFrame : null
    })
  }

  commitNavigation(url: string, anotherNavigationIsLoading = false): void {
    this.nextRoutingId += 1
    this.currentMainFrame = {
      processId: 100,
      routingId: this.nextRoutingId,
      url
    }
    this.loadingMainFrame = anotherNavigationIsLoading
    this.emit(
      'did-frame-navigate',
      {},
      url,
      200,
      'OK',
      true,
      this.currentMainFrame.processId,
      this.currentMainFrame.routingId
    )
  }

  failProvisionalNavigation(url: string): void {
    this.emit(
      'did-fail-provisional-load',
      {},
      -3,
      'ERR_ABORTED',
      url,
      true,
      this.currentMainFrame.processId,
      this.currentMainFrame.routingId
    )
  }

  failNavigation(
    url: string,
    errorCode: number = -105,
    error: string = 'ERR_NAME_NOT_RESOLVED'
  ): void {
    this.emit(
      'did-fail-load',
      {},
      errorCode,
      error,
      url,
      true,
      this.currentMainFrame.processId,
      this.currentMainFrame.routingId
    )
  }

  stopLoading(): void {
    this.loadingMainFrame = false
    this.emit('did-stop-loading')
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }

  asWebContents(): WebContents {
    return this as unknown as WebContents
  }
}

function reportFirebaseAuthState(
  webContents: WebContents,
  state: Parameters<typeof recordFirebaseAuthState>[2]
): void {
  const frame = webContents.mainFrame
  recordFirebaseAuthState(
    webContents,
    { processId: frame.processId, routingId: frame.routingId },
    state
  )
}

const cloudUrl = 'https://cloud.comfy.org/workspaces/test'

function activate(reporter: FakeWebContents): void {
  trackFirebaseAuthReporter(reporter.asWebContents())
  activateFirebaseAuthReporter(reporter.asWebContents())
  reporter.commitNavigation(reporter.getURL())
}

describe('firebaseAuthIdentity consensus', () => {
  beforeEach(() => {
    _resetForTest()
    vi.clearAllMocks()
    telemetry.discardUnmergeableAnonymousEpoch.mockReturnValue(true)
    telemetry.hasUnmergeableAnonymousEpoch.mockReturnValue(false)
    telemetry.isFirebaseConsensusPending.mockReturnValue(true)
    telemetry.markAnonymousEpochUnmergeable.mockReturnValue(true)
    verifiedLocalUsers.clear()
    verifiedLocalPersistence.succeeds = true
  })

  it('waits for every live trusted reporter before binding one agreed user', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
    expect(telemetry.discardUnmergeableAnonymousEpoch).not.toHaveBeenCalled()
  })

  it('waits for active renderer consensus after a main-verified sign-in', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents())
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
    expect(telemetry.registerPersonProperties).not.toHaveBeenCalled()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
  })

  it('applies main-verified properties only after that hosted reporter confirms the UID', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents())
    reporter.navigate(cloudUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.bindUserId).toHaveBeenCalledWith('F', { signed_in_via: 'desktop_2' })
  })

  it('holds a Cloud bind through the reload and identifies once a document re-reports the user', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents(), {
      via: 'desktop_login_code'
    })

    // The attribution is staged with telemetry at bind time; the stale
    // pre-login report is superseded, not trusted: no identify yet.
    expect(telemetry.stageLoginAttribution).toHaveBeenCalledWith('F', {
      via: 'desktop_login_code'
    })
    expect(telemetry.bindUserId).not.toHaveBeenCalled()

    reporter.navigate('https://cloud.comfy.org/workspaces/final')
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.bindUserId).toHaveBeenCalledTimes(1)
    expect(telemetry.bindUserId).toHaveBeenCalledWith('F', { signed_in_via: 'desktop_2' })
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
  })

  it('confirms a Cloud bind from the current document when cross-tab sync reports first', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents())
    // The injected session reaches the pre-reload document via Firebase's
    // cross-tab sync; its report affirms the UID Desktop itself verified.
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.bindUserId).toHaveBeenCalledTimes(1)

    // The reload still happens; the final document produces no second identify.
    reporter.navigate('https://cloud.comfy.org/workspaces/final')
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.bindUserId).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
  })

  it('switches cleanly when the reloaded document reports a different user', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })

    bindMainVerifiedFirebaseUser('F', { email: 'f@example.com' }, reporter.asWebContents())
    reporter.navigate('https://cloud.comfy.org/workspaces/final')
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), {
      status: 'signed_in',
      userId: 'other'
    })

    // A fresher session in the document outranks Desktop's verification; a
    // single resolved reporter is not a conflict, so the epoch stays clean.
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
    expect(telemetry.markAnonymousEpochUnmergeable).not.toHaveBeenCalled()
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('other')
  })

  it('returns to anonymous consensus when the final document confirms sign-out', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })

    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    vi.clearAllMocks()
    reporter.navigate('https://cloud.comfy.org/workspaces/final')
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })

    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
  })

  it('recovers when the post-injection reload fails and the surviving document re-reports', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents())
    const reloadUrl = 'https://cloud.comfy.org/workspaces/final'
    reporter.startNavigation(reloadUrl)
    reporter.failProvisionalNavigation(reloadUrl)
    expect(telemetry.bindUserId).not.toHaveBeenCalled()

    // The injected session is already in IndexedDB, so the surviving
    // pre-reload document observes it and reports the new UID.
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.bindUserId).toHaveBeenCalledTimes(1)
    expect(telemetry.bindUserId).toHaveBeenCalledWith('F', { signed_in_via: 'desktop_2' })
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
  })

  it('holds the bind when the reload outraces it and then fails provisionally', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    vi.clearAllMocks()

    // The injected script reloads the document before executeJavaScript
    // resolves, so the navigation can start before the bind runs and snapshot
    // the stale pre-login signed_out report as the recoverable state.
    const reloadUrl = 'https://cloud.comfy.org/workspaces/final'
    reporter.startNavigation(reloadUrl)
    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents(), {
      via: 'desktop_login_code'
    })
    reporter.failProvisionalNavigation(reloadUrl)

    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.bindUserId).toHaveBeenCalledTimes(1)
    expect(telemetry.bindUserId).toHaveBeenCalledWith('F', { signed_in_via: 'desktop_2' })
    expect(telemetry.stageLoginAttribution).toHaveBeenCalledWith('F', {
      via: 'desktop_login_code'
    })
  })

  it('ignores identity side effects from a mismatched report on an unaccepted frame', () => {
    const localUrl = 'http://127.0.0.1:8188/'
    verifiedLocalUsers.set('http://127.0.0.1:8188', 'A')
    const reporter = new FakeWebContents(localUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'A' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('A')
    vi.clearAllMocks()

    reporter.startNavigation(localUrl)
    // Late IPC from a replaced document: the frame matches no accepted slot.
    recordFirebaseAuthState(
      reporter.asWebContents(),
      { processId: 999, routingId: 999 },
      { status: 'signed_in', userId: 'B' }
    )
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()

    reporter.commitNavigation(localUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'A' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('A')
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
  })

  it('detaches the bound user only when a mismatched local report is accepted', () => {
    const localUrl = 'http://127.0.0.1:8188/'
    verifiedLocalUsers.set('http://127.0.0.1:8188', 'A')
    const reporter = new FakeWebContents(localUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'A' })
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'B' })

    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
  })

  it('ignores a conflicting report on an unaccepted frame and keeps the pending Cloud bind', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents())
    vi.clearAllMocks()

    recordFirebaseAuthState(
      reporter.asWebContents(),
      { processId: 999, routingId: 999 },
      { status: 'signed_in', userId: 'other' }
    )
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
    expect(telemetry.markAnonymousEpochUnmergeable).not.toHaveBeenCalled()

    reporter.navigate('https://cloud.comfy.org/workspaces/final')
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.bindUserId).toHaveBeenCalledTimes(1)
    expect(telemetry.bindUserId).toHaveBeenCalledWith('F', { signed_in_via: 'desktop_2' })
  })

  describe('pending consensus deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('releases the quarantine without detaching when a bound pending window never resolves', () => {
      const reporter = new FakeWebContents(cloudUrl)
      activate(reporter)
      reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
      vi.clearAllMocks()

      reporter.startNavigation(cloudUrl)
      expect(telemetry.applyFirebasePendingConsensus).toHaveBeenCalled()

      vi.advanceTimersByTime(PENDING_CONSENSUS_DEADLINE_MS - 1)
      expect(telemetry.releaseFirebasePendingConsensus).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      // An unresolved reporter is no evidence of sign-out: the identity stays
      // bound and only the write quarantine ends.
      expect(telemetry.releaseFirebasePendingConsensus).toHaveBeenCalledTimes(1)
      expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
      expect(telemetry.capture).toHaveBeenCalledWith(
        'comfy.desktop.identity.pending_consensus_expired'
      )
    })

    it('does not re-quarantine an expired pending episode until consensus resolves', () => {
      const reporter = new FakeWebContents(cloudUrl)
      activate(reporter)
      reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
      vi.clearAllMocks()

      reporter.startNavigation(cloudUrl)
      vi.advanceTimersByTime(PENDING_CONSENSUS_DEADLINE_MS)
      expect(telemetry.releaseFirebasePendingConsensus).toHaveBeenCalledTimes(1)
      vi.clearAllMocks()

      // Still the same wedged episode: commit re-runs reconcile while pending.
      reporter.commitNavigation(cloudUrl)
      expect(telemetry.applyFirebasePendingConsensus).not.toHaveBeenCalled()

      reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
      expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')

      // A fresh navigation after resolution quarantines (and arms) again.
      vi.clearAllMocks()
      reporter.startNavigation(cloudUrl)
      expect(telemetry.applyFirebasePendingConsensus).toHaveBeenCalled()
    })

    it('lets healthy reporters resolve consensus once a wedged reporter expires', () => {
      const wedged = new FakeWebContents(cloudUrl)
      const healthy = new FakeWebContents(cloudUrl)
      activate(wedged)
      activate(healthy)
      reportFirebaseAuthState(wedged.asWebContents(), { status: 'signed_in', userId: 'F' })
      reportFirebaseAuthState(healthy.asWebContents(), { status: 'signed_in', userId: 'F' })
      vi.clearAllMocks()

      wedged.startNavigation(cloudUrl)
      vi.advanceTimersByTime(PENDING_CONSENSUS_DEADLINE_MS)
      vi.clearAllMocks()

      // The wedge no longer vetoes: a real logout and account switch in the
      // healthy window detach and rebind instead of staying attributed to F.
      reportFirebaseAuthState(healthy.asWebContents(), { status: 'signed_out' })
      expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)

      reportFirebaseAuthState(healthy.asWebContents(), { status: 'signed_in', userId: 'B' })
      expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('B')
    })

    it('applies a sign-out masked by a wedged reporter at the deadline instead of releasing', () => {
      const wedged = new FakeWebContents(cloudUrl)
      const healthy = new FakeWebContents(cloudUrl)
      activate(wedged)
      activate(healthy)
      reportFirebaseAuthState(wedged.asWebContents(), { status: 'signed_in', userId: 'F' })
      reportFirebaseAuthState(healthy.asWebContents(), { status: 'signed_in', userId: 'F' })
      vi.clearAllMocks()

      wedged.startNavigation(cloudUrl)
      reportFirebaseAuthState(healthy.asWebContents(), { status: 'signed_out' })
      expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()

      // Resolving detaches and discards held writes; releasing would replay
      // them under the user who already logged out.
      telemetry.isFirebaseConsensusPending.mockReturnValue(false)
      vi.advanceTimersByTime(PENDING_CONSENSUS_DEADLINE_MS)
      expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
      expect(telemetry.releaseFirebasePendingConsensus).not.toHaveBeenCalled()
    })

    it('does not fire the deadline once consensus resolves in time', () => {
      const reporter = new FakeWebContents(cloudUrl)
      activate(reporter)
      reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
      vi.clearAllMocks()

      reporter.startNavigation(cloudUrl)
      reporter.commitNavigation(cloudUrl)
      reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

      vi.advanceTimersByTime(PENDING_CONSENSUS_DEADLINE_MS * 2)
      expect(telemetry.releaseFirebasePendingConsensus).not.toHaveBeenCalled()
      expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
    })
  })

  it('waits for a scoped local reporter after main-verified sign-in and across reload', () => {
    const localUrl = 'http://127.0.0.1:8188/'
    const reporter = new FakeWebContents(localUrl)
    activate(reporter)
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F', { signed_in_via: 'desktop_2' }, reporter.asWebContents())
    expect(telemetry.bindUserId).not.toHaveBeenCalled()

    reporter.navigate(localUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.bindUserId).toHaveBeenCalledWith('F', { signed_in_via: 'desktop_2' })

    vi.clearAllMocks()
    reporter.navigate(localUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.applyFirebasePendingConsensus).toHaveBeenCalled()
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
    expect(telemetry.markAnonymousEpochUnmergeable).not.toHaveBeenCalled()
  })

  it('unbinds a scoped local user on logout and rejects an unverified replacement', () => {
    const localUrl = 'http://127.0.0.1:8188/'
    const reporter = new FakeWebContents(localUrl)
    activate(reporter)
    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    reporter.navigate(localUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
    expect(verifiedLocalUsers.size).toBe(0)

    vi.clearAllMocks()
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'attacker' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
  })

  it('unbinds a scoped local user when the page switches directly to an unverified user', () => {
    const localUrl = 'http://127.0.0.1:8188/'
    const reporter = new FakeWebContents(localUrl)
    activate(reporter)
    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    reporter.navigate(localUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), {
      status: 'signed_in',
      userId: 'attacker'
    })

    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
    expect(verifiedLocalUsers.size).toBe(0)

    vi.clearAllMocks()
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
  })

  it('revokes remote fallback trust on a direct account switch', () => {
    const remoteUrl = 'http://192.168.1.2:8188/'
    const reporter = new FakeWebContents(remoteUrl)
    activate(reporter)
    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    expect(telemetry.bindUserId).toHaveBeenCalledWith('F', {})
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), {
      status: 'signed_in',
      userId: 'attacker'
    })
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    vi.clearAllMocks()
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
  })

  it('revokes remote fallback trust on logout', () => {
    const remoteUrl = 'http://192.168.1.2:8188/'
    const reporter = new FakeWebContents(remoteUrl)
    activate(reporter)
    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    vi.clearAllMocks()
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    vi.clearAllMocks()
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
  })

  it('keeps a remote fallback pending through commit until its new frame confirms', () => {
    const remoteUrl = 'http://192.168.1.2:8188/'
    const reporter = new FakeWebContents(remoteUrl)
    activate(reporter)
    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    vi.clearAllMocks()

    reporter.startNavigation(remoteUrl)
    expect(telemetry.applyFirebasePendingConsensus).toHaveBeenCalled()
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
    reporter.commitNavigation(remoteUrl)
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('retains a remote fallback logout reported while navigation is in flight', () => {
    const remoteUrl = 'http://192.168.1.2:8188/'
    const reporter = new FakeWebContents(remoteUrl)
    activate(reporter)
    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    reporter.startNavigation(`${remoteUrl}?retry=1`)
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    reporter.failProvisionalNavigation(`${remoteUrl}?retry=1`)

    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
  })

  it('rejects source-backed verification after the reporter becomes ineligible', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    deactivateFirebaseAuthReporter(reporter.asWebContents())
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())

    expect(telemetry.bindUserId).not.toHaveBeenCalled()
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
  })

  it('does not clear a conflicted epoch when local verification cannot persist', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })
    const local = new FakeWebContents('http://127.0.0.1:8188/')
    activate(local)
    verifiedLocalPersistence.succeeds = false
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('F1', {}, local.asWebContents())

    expect(telemetry.discardUnmergeableAnonymousEpoch).not.toHaveBeenCalled()
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
  })

  it('restores a previously verified local session after process state resets', () => {
    const localUrl = 'http://127.0.0.1:8188/'
    verifiedLocalUsers.set('http://127.0.0.1:8188', 'F')
    const reporter = new FakeWebContents(localUrl)
    activate(reporter)
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
    expect(telemetry.bindUserId).not.toHaveBeenCalled()
  })

  it('does not apply a local account properties to an unrelated active Cloud account', () => {
    const hosted = new FakeWebContents(cloudUrl)
    activate(hosted)
    reportFirebaseAuthState(hosted.asWebContents(), { status: 'signed_in', userId: 'B' })
    const local = new FakeWebContents('http://127.0.0.1:8188/')
    activate(local)
    vi.clearAllMocks()

    bindMainVerifiedFirebaseUser('A', { email: 'a@example.com' }, local.asWebContents())
    local.navigate(local.getURL())
    reportFirebaseAuthState(local.asWebContents(), { status: 'signed_in', userId: 'A' })

    expect(telemetry.bindUserId).not.toHaveBeenCalled()
    expect(telemetry.registerPersonProperties).not.toHaveBeenCalled()
    expect(telemetry.markAnonymousEpochUnmergeable).toHaveBeenCalled()
  })

  it('keeps the current identity while any live reporter is pending', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    vi.clearAllMocks()

    second.navigate('https://cloud.comfy.org/workspaces/other')
    expect(telemetry.applyFirebasePendingConsensus).toHaveBeenCalled()
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
    expect(telemetry.discardUnmergeableAnonymousEpoch).not.toHaveBeenCalled()
  })

  it('ignores stale auth IPC from the unloading document until navigation commits', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    vi.clearAllMocks()

    reporter.startNavigation(cloudUrl)
    expect(telemetry.applyFirebasePendingConsensus).toHaveBeenCalledTimes(1)

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reporter.commitNavigation(cloudUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F1')
  })

  it('keeps the committed trusted reporter pending before an untrusted destination commits', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F1' })
    vi.clearAllMocks()

    first.startNavigation('https://attacker.example/')
    expect(telemetry.applyFirebasePendingConsensus).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
    expect(telemetry.markAnonymousEpochUnmergeable).not.toHaveBeenCalled()
  })

  it('accepts the committed document while its main frame is still loading', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    reporter.startNavigation(cloudUrl)
    reporter.commitNavigation(cloudUrl, true)
    vi.clearAllMocks()

    expect(reporter.isLoadingMainFrame()).toBe(true)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')

    reporter.stopLoading()
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
  })

  it('keeps the navigation gate across detach and reattach of a retained view', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reporter.startNavigation(cloudUrl)
    deactivateFirebaseAuthReporter(reporter.asWebContents())
    activateFirebaseAuthReporter(reporter.asWebContents())
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reporter.commitNavigation(cloudUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F1')
  })

  it('does not let an older navigation commit open the gate for a newer load', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reporter.startNavigation('https://cloud.comfy.org/workspaces/old')
    deactivateFirebaseAuthReporter(reporter.asWebContents())
    activateFirebaseAuthReporter(reporter.asWebContents())
    reporter.startNavigation('https://cloud.comfy.org/workspaces/new')
    vi.clearAllMocks()

    reporter.commitNavigation('https://cloud.comfy.org/workspaces/old', true)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reporter.commitNavigation('https://cloud.comfy.org/workspaces/new')
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F1')
  })

  it('keeps a trusted committed candidate pending while a newer untrusted load is in flight', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F1' })

    first.startNavigation('https://cloud.comfy.org/workspaces/commits')
    first.startNavigation('https://attacker.example/')
    first.commitNavigation('https://cloud.comfy.org/workspaces/commits', true)
    vi.clearAllMocks()

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
    expect(telemetry.markAnonymousEpochUnmergeable).not.toHaveBeenCalled()
  })

  it('settles a canceled older navigation before the newer document commits', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reporter.startNavigation('https://cloud.comfy.org/workspaces/old')
    reporter.startNavigation('https://cloud.comfy.org/workspaces/new')
    vi.clearAllMocks()

    reporter.failProvisionalNavigation('https://cloud.comfy.org/workspaces/old')
    reporter.failNavigation('https://cloud.comfy.org/workspaces/old', -3, 'ERR_ABORTED')
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reporter.commitNavigation('https://cloud.comfy.org/workspaces/new', true)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F1')
  })

  it('ignores a canceled load ordinary-failure duplicate after a retry starts', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    const canceledUrl = 'https://cloud.comfy.org/workspaces/canceled'
    const retryUrl = 'https://cloud.comfy.org/workspaces/retry'
    reporter.startNavigation(canceledUrl)
    reporter.failProvisionalNavigation(canceledUrl)
    reporter.startNavigation(retryUrl)
    reporter.failNavigation(canceledUrl, -3, 'ERR_ABORTED')
    reporter.commitNavigation(retryUrl, true)
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('settles repeated canceled loads without retaining terminal suppression state', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    const flakyUrl = 'https://cloud.comfy.org/workspaces/flaky'
    const frame = reporter.mainFrame
    reporter.startNavigation(flakyUrl)
    reporter.failProvisionalNavigation(flakyUrl)

    // Commit a later navigation without changing the main-frame identity, as
    // same-process navigations do (the FakeWebContents helper always rotates
    // routing ids, so emit the commit directly).
    reporter.startNavigation(cloudUrl)
    reporter.emit(
      'did-frame-navigate',
      {},
      cloudUrl,
      200,
      'OK',
      true,
      frame.processId,
      frame.routingId
    )
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    vi.clearAllMocks()

    // A later cancellation for the same URL and frame still settles.
    reporter.startNavigation(flakyUrl)
    reporter.failProvisionalNavigation(flakyUrl)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('settles an ordinary failed load so a successful retry can report', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    const retryUrl = 'https://cloud.comfy.org/workspaces/retry'
    reporter.startNavigation(retryUrl)
    reporter.failNavigation(retryUrl)
    reporter.startNavigation(retryUrl)
    reporter.commitNavigation(retryUrl, true)
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('restores the retained document state, including in-flight updates, when a load is canceled', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    // Canceling with no in-flight report re-binds the retained signed-in state.
    reporter.startNavigation('https://cloud.comfy.org/workspaces/canceled')
    vi.clearAllMocks()
    reporter.failProvisionalNavigation('https://cloud.comfy.org/workspaces/canceled')
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')

    // A report from the retained document during a later in-flight load
    // updates its latest auth state without applying it yet…
    reporter.startNavigation('https://cloud.comfy.org/workspaces/canceled-again')
    vi.clearAllMocks()
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    // …so this cancel settles to that latest state, not the old signed-in bind.
    reporter.failProvisionalNavigation('https://cloud.comfy.org/workspaces/canceled-again')
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
  })

  it('promotes a committed candidate only after the newer load is canceled', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    reporter.startNavigation('https://cloud.comfy.org/workspaces/commits')
    reporter.startNavigation('https://cloud.comfy.org/workspaces/canceled')
    reporter.commitNavigation('https://cloud.comfy.org/workspaces/commits', true)
    vi.clearAllMocks()

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'pending' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reporter.failProvisionalNavigation('https://cloud.comfy.org/workspaces/canceled')
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('taints mixed signed-in and signed-out state, then rotates before a later bind', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_out' })

    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('rotates a conflicted epoch once every reporter resolves signed out', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_out' })

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_out' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)

    second.destroy()
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('taints conflicting Firebase users and keeps them anonymous until they agree', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })

    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F2')
  })

  it('retries a required clean rotation and refuses to bind while persistence fails', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_out' })
    telemetry.discardUnmergeableAnonymousEpoch.mockReturnValueOnce(false).mockReturnValueOnce(true)

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(2)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('removes detached, navigated-away, and destroyed reporters from consensus', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    vi.clearAllMocks()

    deactivateFirebaseAuthReporter(second.asWebContents())
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
    vi.clearAllMocks()
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.applyFirebaseAnonymousConsensus).not.toHaveBeenCalled()
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    first.navigate('https://example.com/')
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)

    activateFirebaseAuthReporter(second.asWebContents())
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()
    second.commitNavigation(cloudUrl)
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    second.destroy()
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(2)
  })

  it('ignores reports while the sender is outside a trusted Cloud page', () => {
    const reporter = new FakeWebContents('http://127.0.0.1:8188/')
    activate(reporter)

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    reporter.navigate(cloudUrl)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('honors durable taint after restart before binding the first reporter', () => {
    telemetry.hasUnmergeableAnonymousEpoch.mockReturnValue(true)
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('does not bind if conflict taint cannot be made restart-safe', () => {
    telemetry.markAnonymousEpochUnmergeable.mockReturnValue(false)
    telemetry.discardUnmergeableAnonymousEpoch.mockReturnValue(false)
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_out' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)
    expect(telemetry.applyFirebaseUserConsensus).not.toHaveBeenCalled()

    telemetry.markAnonymousEpochUnmergeable.mockReturnValue(true)
    telemetry.discardUnmergeableAnonymousEpoch.mockReturnValue(true)
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(2)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
  })

  it('replaces the epoch durably when the taint marker cannot persist', () => {
    telemetry.markAnonymousEpochUnmergeable.mockReturnValue(false)
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F1' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(1)

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F2' })
    expect(telemetry.discardUnmergeableAnonymousEpoch).toHaveBeenCalledTimes(2)
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F2')
  })
})

// The reconciled outcome, published rather than only spent on telemetry side effects. Anything
// that needs to know WHICH ACCOUNT this process is serving reads it from here; `staffFlagTargeting`
// is the first such consumer, and its own suite covers what it does with each outcome.
describe('firebaseAuthIdentity published consensus', () => {
  let published: FirebaseIdentityConsensus[] = []
  let unobserve: () => void = () => {}

  beforeEach(() => {
    _resetForTest()
    vi.clearAllMocks()
    telemetry.discardUnmergeableAnonymousEpoch.mockReturnValue(true)
    telemetry.hasUnmergeableAnonymousEpoch.mockReturnValue(false)
    telemetry.isFirebaseConsensusPending.mockReturnValue(true)
    telemetry.markAnonymousEpochUnmergeable.mockReturnValue(true)
    verifiedLocalUsers.clear()
    verifiedLocalPersistence.succeeds = true
    published = []
    unobserve = observeFirebaseIdentityConsensus((consensus) => published.push(consensus))
  })

  afterEach(() => {
    unobserve()
  })

  it('starts out unable to say', () => {
    expect(getFirebaseIdentityConsensus()).toEqual({ status: 'unknown' })
  })

  it('publishes the agreed account once every reporter affirms it', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(published.at(-1)).toEqual({ status: 'pending' })

    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(published.at(-1)).toEqual({ status: 'signed_in', userId: 'F' })
    expect(getFirebaseIdentityConsensus()).toEqual({ status: 'signed_in', userId: 'F' })
  })

  it('publishes a resolved sign-out, which is evidence rather than absence', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_out' })

    expect(published.at(-1)).toEqual({ status: 'signed_out' })
  })

  it('publishes a conflict rather than picking one of two accounts', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F1' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F2' })

    expect(published.at(-1)).toEqual({ status: 'conflicted' })
  })

  it('publishes a conflict when one view is signed in and another is signed out', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)

    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_out' })

    expect(published.at(-1)).toEqual({ status: 'conflicted' })
  })

  it('publishes unknown, NOT signed out, when the last contributor goes away', () => {
    // The distinction the split exists for. Telemetry detaches on both — an in-memory binding
    // with nobody left to affirm it should stop claiming events — but a consumer that PERSISTS
    // the account must not read "every window closed" as "somebody signed out".
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(published.at(-1)).toEqual({ status: 'signed_in', userId: 'F' })

    reporter.destroy()

    expect(published.at(-1)).toEqual({ status: 'unknown' })
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalled()
  })

  it('stays unknown for a local view that was never signed into', () => {
    // Its reports are untrusted until a main-verified sign-in scopes them, so it contributes
    // nothing at all. "No auth store here" is not a vote that nobody is signed in — contrast the
    // cloud view below, whose identical report IS a resolved sign-out.
    const local = new FakeWebContents('http://127.0.0.1:8188/')
    activate(local)

    reportFirebaseAuthState(local.asWebContents(), { status: 'signed_out' })

    expect(getFirebaseIdentityConsensus()).toEqual({ status: 'unknown' })
    expect(published).toEqual([])

    const cloud = new FakeWebContents(cloudUrl)
    activate(cloud)
    reportFirebaseAuthState(cloud.asWebContents(), { status: 'signed_out' })

    expect(getFirebaseIdentityConsensus()).toEqual({ status: 'signed_out' })
  })

  it('publishes on change only', () => {
    // `reconcile()` runs on every navigation event. An observer that re-read a page on each one
    // would be a poll with extra steps.
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    const afterFirst = published.length

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(published).toHaveLength(afterFirst)
  })

  it('holds the last outcome when a tainted epoch defers the bind', () => {
    // Publishing here would announce an account the process has not adopted: telemetry is held
    // anonymous and a retry is expected.
    telemetry.markAnonymousEpochUnmergeable.mockReturnValue(true)
    telemetry.hasUnmergeableAnonymousEpoch.mockReturnValue(true)
    telemetry.discardUnmergeableAnonymousEpoch.mockReturnValue(false)
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(published.at(-1)).toEqual({ status: 'pending' })
    expect(getFirebaseIdentityConsensus()).toEqual({ status: 'pending' })
  })

  it('stops delivering once unsubscribed', () => {
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    unobserve()
    published = []

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(published).toEqual([])
    expect(getFirebaseIdentityConsensus()).toEqual({ status: 'signed_in', userId: 'F' })
  })

  it('keeps reconciling when an observer throws', () => {
    // An observer is a consumer, not a participant. One that fails must not take the identity
    // engine down with it.
    const failing = observeFirebaseIdentityConsensus(() => {
      throw new Error('observer exploded')
    })
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)

    expect(() =>
      reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })
    ).not.toThrow()
    expect(telemetry.applyFirebaseUserConsensus).toHaveBeenCalledWith('F')
    failing()
  })

  it('names the views that hold the agreed account', () => {
    const holder = new FakeWebContents(cloudUrl)
    const other = new FakeWebContents(cloudUrl)
    activate(holder)
    activate(other)
    reportFirebaseAuthState(holder.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(other.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(viewsReportingFirebaseUser('F')).toEqual([holder.asWebContents(), other.asWebContents()])
    expect(viewsReportingFirebaseUser('OTHER')).toEqual([])
  })

  it('names a main-verified view before its reporter has reported', () => {
    // This process already believes that view holds the account, so it is a legitimate one to
    // put a question to.
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)

    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())

    expect(published.at(-1)).toEqual({ status: 'pending' })
    expect(viewsReportingFirebaseUser('F')).toEqual([reporter.asWebContents()])
  })

  it('drops a main-verified view whose document has moved to another origin', () => {
    // `reconcile()` prunes this map on exactly this condition, and pruning happens ONLY in there.
    // Naming a view that has moved would send a caller's question to — and make it trust an answer
    // from — a page at a different origin. Defence in depth: every origin change observed here
    // also runs `reconcile()`, so this guards the window rather than a reproduced live bug.
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    bindMainVerifiedFirebaseUser('F', {}, reporter.asWebContents())
    expect(viewsReportingFirebaseUser('F')).toEqual([reporter.asWebContents()])

    // Moves the document's URL without a commit, so no prune runs in between.
    reporter.navigate('https://elsewhere.example.com/page', true)

    expect(viewsReportingFirebaseUser('F')).toEqual([])
  })

  it('stops dispatching an outcome a nested publish has superseded', () => {
    // An observer can synchronously re-enter `reconcile()`. The nested dispatch delivers the newer
    // outcome to everybody; resuming the outer loop afterwards would hand the observers it had not
    // reached a value that disagrees with `getFirebaseIdentityConsensus()`.
    const seen: string[] = []
    const reporter = new FakeWebContents(cloudUrl)
    activate(reporter)
    const reentrant = observeFirebaseIdentityConsensus((consensus) => {
      seen.push(`reentrant:${consensus.status}`)
      if (consensus.status === 'signed_in') reporter.destroy()
    })
    const later = observeFirebaseIdentityConsensus((consensus) => {
      seen.push(`later:${consensus.status}`)
    })

    reportFirebaseAuthState(reporter.asWebContents(), { status: 'signed_in', userId: 'F' })

    expect(seen).not.toContain('later:signed_in')
    expect(seen).toContain('later:unknown')
    expect(getFirebaseIdentityConsensus()).toEqual({ status: 'unknown' })
    reentrant()
    later()
  })

  it('drops a destroyed view from the ones it names', () => {
    const holder = new FakeWebContents(cloudUrl)
    activate(holder)
    reportFirebaseAuthState(holder.asWebContents(), { status: 'signed_in', userId: 'F' })
    expect(viewsReportingFirebaseUser('F')).toHaveLength(1)

    holder.destroy()

    expect(viewsReportingFirebaseUser('F')).toEqual([])
  })
})
