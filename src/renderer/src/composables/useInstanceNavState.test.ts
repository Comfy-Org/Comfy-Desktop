import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef, triggerRef } from 'vue'

vi.mock('vue-i18n', async (importOriginal) =>
  (await import('../lib/vueI18nWithAppMessages')).vueI18nWithAppMessages(importOriginal)
)

const sessionState = vi.hoisted(() => ({
  running: new Set<string>(),
  launching: new Set<string>()
}))
const sessionStoreVersion = shallowRef(0)
function setRunning(running: Set<string>): void {
  sessionState.running = running
  triggerRef(sessionStoreVersion)
}
function setLaunching(launching: Set<string>): void {
  sessionState.launching = launching
  triggerRef(sessionStoreVersion)
}
vi.mock('../stores/sessionStore', () => ({
  useSessionStore: () => ({
    isRunning: (id: string) => {
      void sessionStoreVersion.value
      return sessionState.running.has(id)
    },
    isLaunching: (id: string) => {
      void sessionStoreVersion.value
      return sessionState.launching.has(id)
    }
  })
}))

import { useInstanceNavState } from './useInstanceNavState'
import { decideNavigation, NAV_LABEL } from '../../../shared/navigation/navDecision'
import type { Installation } from '../types/ipc'
import type { Category, ViewKind } from '../../../shared/viewKind'

function installation(id: string, sourceCategory: string): Installation {
  return { id, name: id, sourceCategory } as Installation
}

beforeEach(() => {
  setRunning(new Set<string>())
  setLaunching(new Set<string>())
})

describe('useInstanceNavState — run-state derivation', () => {
  it('classifies the running host self install as self', () => {
    setRunning(new Set(['A']))
    const navState = useInstanceNavState(ref(installation('A', 'local')), {
      currentView: 'instance' as ViewKind,
      currentCategory: 'local' as Category,
      activeInstallationId: 'A'
    })
    expect(navState.targetRun.value).toBe('self')
    expect(navState.isTargetCurrentHost.value).toBe(true)
  })

  it('reads an active-but-not-yet-running host install as stopped (CTA stays "Start")', () => {
    const navState = useInstanceNavState(ref(installation('A', 'local')), {
      currentView: 'instance' as ViewKind,
      currentCategory: 'local' as Category,
      activeInstallationId: 'A'
    })
    expect(navState.targetRun.value).toBe('stopped')
  })

  it('classifies a stopped non-host install as stopped', () => {
    const navState = useInstanceNavState(ref(installation('B', 'local')), {
      currentView: 'instance' as ViewKind,
      currentCategory: 'local' as Category,
      activeInstallationId: 'A'
    })
    expect(navState.targetRun.value).toBe('stopped')
  })

  it('classifies an install running in another window as running-elsewhere', () => {
    setRunning(new Set(['B']))
    const navState = useInstanceNavState(ref(installation('B', 'local')), {
      currentView: 'instance' as ViewKind,
      currentCategory: 'local' as Category,
      activeInstallationId: 'A'
    })
    expect(navState.targetRun.value).toBe('running-elsewhere')
  })

  it('classifies an install starting on a dashboard card, with no window, as starting-unhosted', () => {
    setLaunching(new Set(['A']))
    const navState = useInstanceNavState(ref(installation('A', 'local')), {
      currentView: 'dashboard' as ViewKind,
      currentCategory: null,
      activeInstallationId: null,
      startingWithoutWindow: true
    })
    expect(navState.targetRun.value).toBe('starting-unhosted')
  })

  it('keeps an install that another window is booting as running-elsewhere', () => {
    setLaunching(new Set(['A']))
    const navState = useInstanceNavState(ref(installation('A', 'local')), {
      currentView: 'dashboard' as ViewKind,
      currentCategory: null,
      activeInstallationId: null,
      startingWithoutWindow: false
    })
    expect(navState.targetRun.value).toBe('running-elsewhere')
  })

  it('reads the install as stopped again once its windowless launch has ended', () => {
    const startingWithoutWindow = ref(true)
    setLaunching(new Set(['A']))
    const navState = useInstanceNavState(ref(installation('A', 'local')), {
      currentView: 'dashboard' as ViewKind,
      currentCategory: null,
      activeInstallationId: null,
      startingWithoutWindow
    })
    expect(navState.targetRun.value).toBe('starting-unhosted')
    setLaunching(new Set<string>())
    expect(navState.targetRun.value).toBe('stopped')
  })

  it('remote target routes like a cloud target (non-local URL backend)', () => {
    const navState = useInstanceNavState(ref(installation('R', 'remote')), {
      currentView: 'cloud' as ViewKind,
      currentCategory: 'remote' as Category,
      activeInstallationId: null
    })
    expect(navState.targetClass.value).toBe('cloud')
    expect(navState.targetKind.value).toBe('cloud')
    expect(navState.currentClass.value).toBe('cloud')
  })

  it('reports a dashboard host as a chooser with null class', () => {
    const navState = useInstanceNavState(ref(installation('A', 'local')), {
      currentView: 'dashboard' as ViewKind,
      currentCategory: null,
      activeInstallationId: null
    })
    expect(navState.isCurrentChooser.value).toBe(true)
    expect(navState.currentClass.value).toBeNull()
  })
})

describe('useInstanceNavState → decideNavigation (end to end)', () => {
  it('dashboard host picking a build that is starting on its card → Restart, not Switch', () => {
    setLaunching(new Set(['A']))
    const navState = useInstanceNavState(ref(installation('A', 'local')), {
      currentView: 'dashboard' as ViewKind,
      currentCategory: null,
      activeInstallationId: null,
      startingWithoutWindow: true
    })
    const decision = decideNavigation(navState.navInput())
    expect(decision.verb).toBe('restart')
    expect(decision.primaryLabel).toBe(NAV_LABEL.restart)
  })

  it('instance host picking a stopped local instance → Start in its own window', () => {
    const navState = useInstanceNavState(ref(installation('B', 'local')), {
      currentView: 'instance' as ViewKind,
      currentCategory: 'local' as Category,
      activeInstallationId: 'A'
    })
    const decision = decideNavigation(navState.navInput())
    expect(decision).toEqual({ verb: 'start', primaryLabel: NAV_LABEL.start })
  })

  it('dashboard host picking a stopped cloud install → Open Cloud', () => {
    const navState = useInstanceNavState(ref(installation('cloud', 'cloud')), {
      currentView: 'dashboard' as ViewKind,
      currentCategory: null,
      activeInstallationId: null
    })
    expect(decideNavigation(navState.navInput())).toEqual({
      verb: 'start',
      primaryLabel: NAV_LABEL.openCloud
    })
  })

  it('cloud host picking a stopped instance → opens in a new window', () => {
    const navState = useInstanceNavState(ref(installation('B', 'local')), {
      currentView: 'cloud' as ViewKind,
      currentCategory: 'cloud' as Category,
      activeInstallationId: 'cloud'
    })
    const decision = decideNavigation(navState.navInput())
    expect(decision).toEqual({ verb: 'start', primaryLabel: NAV_LABEL.start })
  })

  it('cloud host picking a stopped REMOTE connection → opens in a new window (not a dead no-op)', () => {
    const navState = useInstanceNavState(ref(installation('R', 'remote')), {
      currentView: 'cloud' as ViewKind,
      currentCategory: 'cloud' as Category,
      activeInstallationId: 'cloud'
    })
    const decision = decideNavigation(navState.navInput())
    expect(decision).toEqual({ verb: 'start', primaryLabel: NAV_LABEL.openCloud })
  })

  it('instance host → stopped REMOTE routes identically to stopped Cloud (no in-place 3-way)', () => {
    const sources = {
      currentView: 'instance' as ViewKind,
      currentCategory: 'local' as Category,
      activeInstallationId: 'A'
    }
    const remote = decideNavigation(
      useInstanceNavState(ref(installation('R', 'remote')), sources).navInput()
    )
    const cloud = decideNavigation(
      useInstanceNavState(ref(installation('C', 'cloud')), sources).navInput()
    )
    expect(remote).toEqual({ verb: 'start', primaryLabel: NAV_LABEL.openCloud })
    expect(remote).toEqual(cloud)
  })
})
