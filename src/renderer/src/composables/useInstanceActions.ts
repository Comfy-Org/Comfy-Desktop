import type { NavDecision } from '../../../shared/navigation/navDecision'
import type { Installation } from '../types/ipc'

export interface InstanceActionsBridge {
  pickInstall: (installationId: string) => void
  restartInstall: (installationId: string, opts?: { confirmed?: boolean }) => void
  openInstallNewWindow?: (installationId: string, opts?: { allowDuplicate?: boolean }) => void
  openNewInstall?: () => void
}

export interface InstanceActionsDeps {
  bridge: InstanceActionsBridge | undefined
  confirmLocalKill: (inst: Installation) => Promise<boolean>
}

export interface InstanceActions {
  dispatch: (decision: NavDecision, target: Installation) => Promise<void>
}

export function useInstanceActions(deps: InstanceActionsDeps): InstanceActions {
  async function dispatch(decision: NavDecision, target: Installation): Promise<void> {
    const { bridge } = deps
    if (!bridge) return

    try {
      switch (decision.verb) {
        case 'restart': {
          if (!(await deps.confirmLocalKill(target))) return
          bridge.restartInstall(target.id, { confirmed: true })
          return
        }
        case 'open-new': {
          bridge.openInstallNewWindow?.(target.id, { allowDuplicate: decision.allowDuplicate })
          return
        }
        case 'focus': {
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
