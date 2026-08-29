import type { TelemetryContext } from './telemetry'

export type ModelLoadTrigger = 'requested' | 'dynamic_prepare' | 'deepclone'

interface ModelLoadObservation {
  modelClass: string
  trigger: ModelLoadTrigger
  targetDevice: string | null
}

interface DatedModelLoadObservation extends ModelLoadObservation {
  observationDate: string
  count: number
}

// Cold loads only: ComfyUI logs this solely when the model is not already
// resident, so warm reuse is invisible to this trigger.
const REQUESTED_LOAD_LINE = /^Requested to load\s+([A-Za-z_][A-Za-z0-9_]{0,63})\s*$/
// A repeated identical prepare inside a sampling loop is logged at DEBUG, which
// Desktop's INFO-level console drops, so counts here undercount actual prepares.
const DYNAMIC_PREPARE_LINE =
  /^Model\s+([A-Za-z_][A-Za-z0-9_]{0,63})\s+prepared for dynamic VRAM loading\b/
// Multi-GPU only; the sole trigger carrying a target device.
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
  recordLine: (line: string, observedAtMs?: number) => boolean
  drainProperties: () => TelemetryContext | null
} {
  const counts = new Map<string, DatedModelLoadObservation>()
  const seenModelKeys = new Set<string>()
  let truncated = false

  return {
    recordLine(line: string, observedAtMs = Date.now()): boolean {
      const observation = parseModelLoadObservation(line)
      if (!observation) return false

      const modelKey = `${observation.modelClass}\t${observation.trigger}\t${observation.targetDevice ?? ''}`
      if (!seenModelKeys.has(modelKey)) {
        if (seenModelKeys.size >= MAX_TRACKED_MODEL_KEYS) {
          truncated = true
          return true
        }
        seenModelKeys.add(modelKey)
      }

      const observationDate = new Date(observedAtMs).toISOString().slice(0, 10)
      const key = `${observationDate}\t${modelKey}`
      const current = counts.get(key)
      if (current) {
        current.count++
        return true
      }
      counts.set(key, { ...observation, observationDate, count: 1 })
      return true
    },
    drainProperties(): TelemetryContext | null {
      if (counts.size === 0 && !truncated) return null
      const entries = [...counts.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, observation]) => observation)
      counts.clear()
      const wasTruncated = truncated
      truncated = false

      return {
        model_usage_schema_version: 1,
        model_observation_semantics: 'runtime_load_log_v1',
        model_observation_dates: entries.map((entry) => entry.observationDate),
        model_classes: entries.map((entry) => entry.modelClass),
        model_load_triggers: entries.map((entry) => entry.trigger),
        model_target_devices: entries.map((entry) => entry.targetDevice),
        model_load_counts: entries.map((entry) => entry.count),
        model_usage_truncated: wasTruncated
      }
    }
  }
}
