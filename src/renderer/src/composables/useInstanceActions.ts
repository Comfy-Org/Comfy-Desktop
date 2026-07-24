import type { NavDecision } from '../../../shared/navigation/navDecision'
import type { Installation } from '../types/ipc'

/**
 * Single funnel that routes a `NavDecision`'s verb onto the host bridge,
 * applying the renderer-side gates (cloud capacity, local kill-confirm) that
 * main would otherwise re-prompt for.
 */
/** Outcome of the in-drawer switch prompt. */
export type SwitchChoice = 'switch' | 'new-window' | 'cancel'

export interface InstanceActionsBridge {
  /** Swap the install into the current window (detach + re-attach in place).
   *  `confirmed` tells main the renderer already prompted, so it skips its modal. */
  pickInstall: (installationId: string, opts?: { confirmed?: boolean }) => void
  /** Restart the install running in the current window. `confirmed` tells main
   *  the renderer already prompted, so it skips its own system-modal. */
  restartInstall: (installationId: string, opts?: { confirmed?: boolean }) => void
  /** Land the install in its own window, leaving the current one untouched.
   *  `allowDuplicate` opens a second window for an install that already owns
   *  one (cloud-self only). */
  openInstallNewWindow?: (installationId: string, opts?: { allowDuplicate?: boolean }) => void
  /** Open the new-install wizard. */
  openNewInstall?: () => void
}

export interface InstanceActionsDeps {
  bridge: InstanceActionsBridge | undefined
  /** Confirm a local process kill (restart). Returns true to proceed; non-local
   *  installs have no process to kill and should resolve true. */
  confirmLocalKill: (inst: Installation) => Promise<boolean>
  /** Cloud capacity gate; returns false to abort a cloud action. */
  confirmCloudCapacity: (inst: Installation) => Promise<boolean>
  /** In-drawer 3-way prompt when the current host is a local install: stop &
   *  switch / open in new window / cancel. Resolves `'switch'` for non-local. */
  confirmSwitch: (inst: Installation) => Promise<SwitchChoice>
}

export interface InstanceActions {
  /** Execute a navigation decision against the target install. */
  dispatch: (decision: NavDecision, target: Installation) => Promise<void>
}

export function useInstanceActions(deps: InstanceActionsDeps): InstanceActions {
  /**
   * Route a decision's verb onto the bridge. A rejected confirm dialog (e.g. the
   * host tears down mid-prompt) is treated as "not confirmed" — the action
   * aborts instead of surfacing an unhandled rejection to the caller.
   */
  async function dispatch(decision: NavDecision, target: Installation): Promise<void> {
    const { bridge } = deps
    if (!bridge) return

    try {
      // Cloud capacity gate first, matching the ChooserView path.
      if (target.sourceCategory === 'cloud' && !(await deps.confirmCloudCapacity(target))) return

      switch (decision.verb) {
        case 'restart': {
          // `confirmed: true` tells main to skip its own modal (non-local resolves true).
          if (!(await deps.confirmLocalKill(target))) return
          bridge.restartInstall(target.id, { confirmed: true })
          return
        }
        case 'switch': {
          // In-drawer 3-way (stop & switch / new window / cancel) before main acts.
          const choice = await deps.confirmSwitch(target)
          if (choice === 'cancel') return
          if (choice === 'new-window') {
            bridge.openInstallNewWindow?.(target.id)
            return
          }
          bridge.pickInstall(target.id, { confirmed: true })
          return
        }
        case 'open-new': {
          bridge.openInstallNewWindow?.(target.id, { allowDuplicate: decision.allowDuplicate })
          return
        }
        case 'focus': {
          // Same bridge call as a pick; main short-circuits to focus when already up.
          bridge.pickInstall(target.id)
          return
        }
        case 'install-wizard': {
          bridge.openNewInstall?.()
          return
        }
        case 'no-op':
          return
      }
    } catch (err) {
      console.error('useInstanceActions.dispatch failed:', err)
    }
  }

  return { dispatch }
}
