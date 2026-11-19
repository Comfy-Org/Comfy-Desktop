import type { ShowProgressOpts } from '../types/ipc'

export type ProgressRouting = 'same-host' | 'target-host' | 'inline-picker'

export interface ProgressRoutingDecision {
  routing: ProgressRouting
  successChoice: boolean
}

const LAUNCH_ACTION_IDS = new Set(['launch', 'restart'])

export function resolveProgressRouting(
  opts: ShowProgressOpts,
  _hostInstallId: string | null
): ProgressRoutingDecision {
  if (opts.destroysInstance) {
    return { routing: 'same-host', successChoice: false }
  }

  if (opts.actionId && LAUNCH_ACTION_IDS.has(opts.actionId)) {
    return { routing: 'target-host', successChoice: false }
  }

  if (opts.actionId === 'migrate-to-standalone') {
    return { routing: 'same-host', successChoice: false }
  }

  return { routing: 'inline-picker', successChoice: true }
}
