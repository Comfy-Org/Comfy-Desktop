import {
  isCompatibleLocalWorkflowBuild,
  type LocalBuildVersions
} from '../../../shared/catalogWorkflowCompatibility'
import type {
  CatalogWorkflow,
  CatalogWorkflowModel,
  CatalogWorkflowNeeds,
  Installation
} from '../types/ipc'
import { isCloudBuild } from './home/homeBuild'

export type TargetState =
  | 'ready'
  | 'missing'
  | 'checking'
  | 'outdated'
  | 'not-on-cloud'
  | 'signed-out'
  | 'offline'
  | 'cloud-ready'

export interface TargetChoice {
  key: string
  where: 'local' | 'cloud'
  build: Installation
  running: boolean
  state: TargetState
  missing: CatalogWorkflowModel[]
  disabled: boolean
}

export interface TargetContext {
  workflow: CatalogWorkflow
  installations: readonly Installation[]
  versions: LocalBuildVersions
  needs: CatalogWorkflowNeeds | null | undefined
  isRunning: (id: string) => boolean
  signedIn: boolean
  online: boolean
}

function lastUsed(build: Installation): number {
  return typeof build.lastLaunchedAt === 'number' ? build.lastLaunchedAt : 0
}

function localChoice(build: Installation, context: TargetContext): TargetChoice {
  const { workflow, versions, needs } = context
  const running = context.isRunning(build.id)
  const base = { key: `local:${build.id}`, where: 'local' as const, build, running }
  if (!isCompatibleLocalWorkflowBuild(build, versions, workflow.minComfyUIVersion)) {
    return { ...base, state: 'outdated', missing: [], disabled: true }
  }
  if (needs === undefined) return { ...base, state: 'checking', missing: [], disabled: false }
  const missingNames = new Set(needs?.missingByBuild[build.id] ?? [])
  const missing = (needs?.models ?? []).filter((model) => missingNames.has(model.filename))
  return { ...base, state: missing.length > 0 ? 'missing' : 'ready', missing, disabled: false }
}

function cloudChoice(build: Installation, context: TargetContext): TargetChoice {
  const base = { key: 'cloud', where: 'cloud' as const, build, running: false, missing: [] }
  if (!context.workflow.canOpenCloud) return { ...base, state: 'not-on-cloud', disabled: true }
  if (!context.online) return { ...base, state: 'offline', disabled: false }
  if (!context.signedIn) return { ...base, state: 'signed-out', disabled: false }
  return { ...base, state: 'cloud-ready', disabled: false }
}

export function targetChoices(context: TargetContext): TargetChoice[] {
  const locals = context.workflow.canOpenLocal
    ? context.installations
        .filter((build) => build.sourceCategory === 'local' && build.id in context.versions)
        .sort((a, b) => lastUsed(b) - lastUsed(a))
        .map((build) => localChoice(build, context))
    : []
  const cloud = context.installations.find(isCloudBuild)
  return cloud ? [...locals, cloudChoice(cloud, context)] : locals
}

function preference(choice: TargetChoice): number {
  if (choice.disabled) return 99
  if (choice.where === 'local' && choice.state === 'ready') return choice.running ? 0 : 1
  if (choice.where === 'local' && choice.state === 'checking') return choice.running ? 2 : 3
  if (choice.where === 'cloud') return 4
  return 5 + choice.missing.length
}

export function bestChoice(choices: readonly TargetChoice[]): TargetChoice | null {
  let best: TargetChoice | null = null
  for (const choice of choices) {
    if (choice.disabled) continue
    if (!best || preference(choice) < preference(best)) best = choice
  }
  return best
}

export function knownBytes(models: readonly CatalogWorkflowModel[]): number | null {
  if (models.length === 0 || models.some((model) => model.sizeBytes === null)) return null
  return models.reduce((total, model) => total + (model.sizeBytes ?? 0), 0)
}
