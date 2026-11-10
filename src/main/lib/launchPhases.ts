export interface LaunchPhaseDef {
  phase: string
  match: RegExp
  weight: number
  streaming: boolean
}

const NEVER = /$^/

export const DEFAULT_LAUNCH_PHASES: readonly LaunchPhaseDef[] = [
  {
    phase: 'launchStart',
    match: NEVER,
    weight: 0.05,
    streaming: true
  },
  {
    phase: 'securityScan',
    match: /Adding extra search path|ComfyUI startup time/i,
    weight: 0.05,
    streaming: false
  },
  {
    phase: 'mountLibraries',
    match: /\[DONE\] Security scan/i,
    weight: 0.05,
    streaming: true
  },
  {
    phase: 'gpu',
    match: /Total VRAM\s+(\d+)\s*MB/i,
    weight: 0.5,
    streaming: true
  },
  {
    phase: 'customNodes',
    match: /ComfyUI version:|Import times for custom nodes:/i,
    weight: 0.15,
    streaming: false
  },
  {
    phase: 'startingServer',
    match: /Starting server|To see the GUI go to:|Uvicorn running on/i,
    weight: 0.2,
    streaming: true
  }
]

export type PreLaunchPhase = 'repair' | 'torchRepair'

const PRE_LAUNCH_PHASES: Record<PreLaunchPhase, LaunchPhaseDef> = {
  repair: { phase: 'repair', match: NEVER, weight: 0.1, streaming: true },
  torchRepair: { phase: 'torchRepair', match: NEVER, weight: 0.1, streaming: true }
}

export const AGENT_REQUIREMENTS_PHASE: LaunchPhaseDef = {
  phase: 'agentRequirements',
  match: NEVER,
  weight: 0.1,
  streaming: true
}

export const FRONTEND_RESTORE_PHASE: LaunchPhaseDef = {
  phase: 'frontendRestore',
  match: NEVER,
  weight: 0.05,
  streaming: true
}

const TEMPLATE_MODELS_PHASE: LaunchPhaseDef = {
  phase: 'template-models',
  match: NEVER,
  weight: 0.05,
  streaming: true
}

export interface BuildLaunchPhasesOpts {
  preLaunchPhases?: PreLaunchPhase[]
  templateModels?: boolean
}

export function buildLaunchPhases(
  _inst: unknown,
  opts: BuildLaunchPhasesOpts = {}
): LaunchPhaseDef[] {
  const pre = (opts.preLaunchPhases ?? []).map((id) => ({ ...PRE_LAUNCH_PHASES[id] }))
  const phases = [...pre, ...DEFAULT_LAUNCH_PHASES.map((p) => ({ ...p }))]
  if (opts.templateModels) {
    phases.push({ ...TEMPLATE_MODELS_PHASE })
  }
  return phases
}
