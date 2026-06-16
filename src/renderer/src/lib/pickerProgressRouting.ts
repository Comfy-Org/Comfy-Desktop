import type { ShowProgressOpts } from '../types/ipc'

export type ProgressRouting = 'same-host' | 'target-host' | 'inline-picker'

export interface ProgressRoutingDecision {
  /** same-host: ProgressModal in picker's panel; target-host: target window; inline-picker: picker right pane. */
  routing: ProgressRouting
  /** When true, a success state with an `[Open Instance]` CTA is shown. */
  successChoice: boolean
}

// Excludes update-with-auto-relaunch, which sets triggersInstanceStart but still gets a choice screen.
const LAUNCH_ACTION_IDS = new Set(['launch', 'restart'])

/** Pure policy for where a picker-initiated progress op renders and whether it ends on a choice screen. */
export function resolveProgressRouting(
  opts: ShowProgressOpts,
  _hostInstallId: string | null,
): ProgressRoutingDecision {
  // Destructive ops stay in the current host — routing to a window about to be torn down would leave a ghost.
  if (opts.destroysInstance) {
    return { routing: 'same-host', successChoice: false }
  }

  if (opts.actionId && LAUNCH_ACTION_IDS.has(opts.actionId)) {
    return { routing: 'target-host', successChoice: false }
  }

  // Legacy Desktop adoption can ask main-process follow-up questions
  // (venv-broken, source-missing). Those prompts are bridged only by the
  // panel (useAdoptPromptBridge), so migrate must run through the panel
  // ProgressModal rather than the picker's inline background op — whose
  // stub sender can't deliver prompts. ProgressModal.handleDone already
  // opens the newly adopted install via `newInstallationId`, so no success
  // choice screen is needed.
  if (opts.actionId === 'migrate-to-standalone') {
    return { routing: 'same-host', successChoice: false }
  }

  return { routing: 'inline-picker', successChoice: true }
}
