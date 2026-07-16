import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const telemetry = vi.hoisted(() => ({
  applyFirebaseAnonymousConsensus: vi.fn(),
  applyFirebaseUserConsensus: vi.fn(),
  discardUnmergeableAnonymousEpoch: vi.fn(() => true),
  hasUnmergeableAnonymousEpoch: vi.fn(() => false),
  markAnonymousEpochUnmergeable: vi.fn(() => true)
}))

vi.mock('./telemetry', () => telemetry)

import {
  _resetForTest,
  activateFirebaseAuthReporter,
  deactivateFirebaseAuthReporter,
  reportFirebaseAuthState as recordFirebaseAuthState,
  trackFirebaseAuthReporter
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
    telemetry.markAnonymousEpochUnmergeable.mockReturnValue(true)
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

  it('unbinds while any live reporter is pending without tainting the epoch', () => {
    const first = new FakeWebContents(cloudUrl)
    const second = new FakeWebContents(cloudUrl)
    activate(first)
    activate(second)
    reportFirebaseAuthState(first.asWebContents(), { status: 'signed_in', userId: 'F' })
    reportFirebaseAuthState(second.asWebContents(), { status: 'signed_in', userId: 'F' })
    vi.clearAllMocks()

    second.navigate('https://cloud.comfy.org/workspaces/other')
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)

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
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)

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
    expect(telemetry.applyFirebaseAnonymousConsensus).toHaveBeenCalledTimes(1)
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
