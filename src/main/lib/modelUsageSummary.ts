import type { TelemetryContext } from './telemetry'

export type ModelLoadTrigger = 'requested' | 'dynamic_prepare' | 'deepclone'

interface ModelLoadObservation {
  modelClass: string
  trigger: ModelLoadTrigger
  targetDevice: string | null
}

const REQUESTED_LOAD_LINE = /^Requested to load\s+([A-Za-z_][A-Za-z0-9_]{0,63})\s*$/
const DYNAMIC_PREPARE_LINE =
  /^Model\s+([A-Za-z_][A-Za-z0-9_]{0,63})\s+prepared for dynamic VRAM loading\b/
const DEEPCLONE_LINE =
  /^(?:Creating deepclone of|Reusing loaded multigpu deepclone of)\s+([A-Za-z_][A-Za-z0-9_]{0,63})\s+for\s+([a-z][a-z0-9]{0,31}(?::\d{1,4})?)/

const MAX_TRACKED_MODEL_KEYS = 60

export function parseModelLoadObservation(line: string): ModelLoadObservation | null {
  const requested = line.match(REQUESTED_LOAD_LINE)?.[1]
  if (requested) {
    return { modelClass: requested, trigger: 'requested', targetDevice: null }
  }

  const dynamicPrepare = line.match(DYNAMIC_PREPARE_LINE)?.[1]
  if (dynamicPrepare) {
    return {
      modelClass: dynamicPrepare,
      trigger: 'dynamic_prepare',
      targetDevice: null
    }
  }

  const deepclone = line.match(DEEPCLONE_LINE)
  if (!deepclone?.[1] || !deepclone[2]) return null
  return {
    modelClass: deepclone[1],
    trigger: 'deepclone',
    targetDevice: deepclone[2]
  }
}

export function createModelUsageSummary(): {
  recordLine: (line: string) => void
  properties: () => TelemetryContext
} {
  const counts = new Map<string, ModelLoadObservation & { count: number }>()
  let truncated = false

  return {
    recordLine(line: string): void {
      const observation = parseModelLoadObservation(line)
      if (!observation) return

      const key = `${observation.modelClass}\t${observation.trigger}\t${observation.targetDevice ?? ''}`
      const current = counts.get(key)
      if (current) {
        counts.set(key, { ...current, count: current.count + 1 })
        return
      }
      if (counts.size >= MAX_TRACKED_MODEL_KEYS) {
        truncated = true
        return
      }
      counts.set(key, { ...observation, count: 1 })
    },
    properties(): TelemetryContext {
      const entries = [...counts.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, observation]) => observation)

      return {
        model_usage_schema_version: 1,
        model_observation_semantics: 'runtime_load_log_v1',
        model_classes: entries.map((entry) => entry.modelClass),
        model_load_triggers: entries.map((entry) => entry.trigger),
        model_target_devices: entries.map((entry) => entry.targetDevice),
        model_load_counts: entries.map((entry) => entry.count),
        model_usage_truncated: truncated
      }
    }
  }
}
