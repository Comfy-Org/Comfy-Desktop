import { describe, expect, it } from 'vitest'

import { firstUseModeForOverlaySwap } from './usePanelOverlays'
import type { Overlay } from '../composables/useOverlay'

// Pins the overlay-watcher lockdown decisions: the first-use chain
// handoff must not clobber the chain's 'post-consent' assert, while a
// stale chain flag must never suppress the 'none' push on ordinary
// overlay closes (the Skip Onboarding lockdown bug's regression case).

const progressTakeover: Overlay = { kind: 'takeover', component: 'update' }
const firstUseTakeover: Overlay = { kind: 'takeover', component: 'first-use' }
const newInstallTakeover: Overlay = { kind: 'takeover', component: 'new-install' }
const progressOverlay: Overlay = { kind: 'progress', installationId: 'inst-1' }

describe('firstUseModeForOverlaySwap', () => {
  it('pushes loading-lockdown when the ProgressModal takeover mounts', () => {
    expect(firstUseModeForOverlaySwap(progressTakeover, null, false)).toBe('loading-lockdown')
  })

  it('stays silent while the ProgressModal takeover remains up', () => {
    expect(firstUseModeForOverlaySwap(progressTakeover, progressTakeover, false)).toBeNull()
  })

  it('stays silent while a first-use takeover is on screen (it owns its own pushes)', () => {
    expect(firstUseModeForOverlaySwap(firstUseTakeover, null, false)).toBeNull()
    expect(firstUseModeForOverlaySwap(firstUseTakeover, newInstallTakeover, true)).toBeNull()
  })

  it('suppresses the none push on the first-use -> takeover chain handoff', () => {
    expect(firstUseModeForOverlaySwap(newInstallTakeover, firstUseTakeover, true)).toBeNull()
  })

  it('pushes none on a first-use -> takeover swap when the chain is NOT active', () => {
    expect(firstUseModeForOverlaySwap(newInstallTakeover, firstUseTakeover, false)).toBe('none')
  })

  it('pushes none on an ordinary first-use close even with a stale chain flag', () => {
    expect(firstUseModeForOverlaySwap(null, firstUseTakeover, true)).toBe('none')
  })

  it('pushes none on a first-use -> progress (non-takeover) transition despite an active chain', () => {
    expect(firstUseModeForOverlaySwap(progressOverlay, firstUseTakeover, true)).toBe('none')
  })

  it('pushes none when the ProgressModal takeover closes', () => {
    expect(firstUseModeForOverlaySwap(null, progressTakeover, false)).toBe('none')
  })

  it('pushes none on the immediate mount fire with no overlay (clears stale lockdown drift)', () => {
    expect(firstUseModeForOverlaySwap(null, undefined, false)).toBe('none')
  })
})
