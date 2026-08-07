import type { ProgressStep } from '../types/ipc'

/**
 * Curated per-op weight tables for the unified `globalProgress` bar, used when
 * the producer doesn't send per-step weights itself. Each maps `phase` →
 * weight in `[0, 1]` summing to 1.0; weights reflect what dominates wall time
 * in the median run. Keyed by the sorted phase-name fingerprint of `op.steps`
 * (durable across install-name-varying titles). Bad calibration only mis-paces
 * a section — the monotonic clamp in `progressStore.globalProgressFor`
 * prevents regressions.
 *
 * The launch flow is NOT here: it sends weights inline on its steps (see
 * `launchPhases.ts` / `launchProgress.ts`), so main is the single source.
 */
const TABLES: Record<string, Record<string, number>> = {
  // Standalone install — common case (no pending snapshot)
  'cleanup|download|extract|setup|update': {
    download: 0.4,
    extract: 0.2,
    setup: 0.3,
    cleanup: 0.05,
    update: 0.05
  },
  // Standalone install + snapshot restore
  'cleanup|download|extract|restore-nodes|restore-pip|setup|update': {
    download: 0.3,
    extract: 0.15,
    setup: 0.2,
    cleanup: 0.05,
    update: 0.05,
    'restore-nodes': 0.15,
    'restore-pip': 0.1
  },
  // Portable install (no Python env, no update probe)
  'download|extract': {
    download: 0.7,
    extract: 0.3
  },
  // ComfyBuilder distribution install: archive download dominates wall time;
  // model staging varies but is small when a distribution declares few/none.
  'download|extract|models': {
    download: 0.65,
    extract: 0.15,
    models: 0.20,
  },
  // Legacy Desktop migrate
  migration: {
    migration: 1.0
  },
  // Migrate + snapshot restore
  'migration|restore-nodes|restore-pip': {
    migration: 0.7,
    'restore-nodes': 0.18,
    'restore-pip': 0.12
  },
  // Legacy Desktop adoption (non-macOS — no `tcc` step). Source +
  // requirements dominate wall time; the rest are fast.
  'allocate|backup|register|requirements|settings|snapshot|source|venv': {
    backup: 0.05,
    venv: 0.03,
    snapshot: 0.05,
    allocate: 0.02,
    source: 0.38,
    requirements: 0.37,
    settings: 0.05,
    register: 0.05
  },
  // Legacy Desktop adoption on macOS — same shape plus a `tcc` access
  // check step.
  'allocate|backup|register|requirements|settings|snapshot|source|tcc|venv': {
    backup: 0.05,
    tcc: 0.02,
    venv: 0.03,
    snapshot: 0.05,
    allocate: 0.02,
    source: 0.36,
    requirements: 0.37,
    settings: 0.05,
    register: 0.05
  }
}

export function fingerprintSteps(steps: readonly ProgressStep[]): string {
  return steps
    .map((s) => s.phase)
    .slice()
    .sort()
    .join('|')
}

/** Phase → weight for an op's bar. Prefers weights the producer sent inline on
 *  the steps (normalized to sum 1.0); else a curated `TABLES` entry; else an
 *  equal split. */
export function getPhaseWeights(steps: readonly ProgressStep[]): Record<string, number> {
  const n = steps.length
  if (n === 0) return {}

  if (steps.some((s) => s.weight !== undefined)) {
    const total = steps.reduce((a, s) => a + (s.weight ?? 0), 0)
    const out: Record<string, number> = {}
    // Normalize so an injected step (e.g. repair) can't push the sum past 1.0;
    // an all-zero total degrades to an equal split rather than dividing by 0.
    for (const s of steps) out[s.phase] = total > 0 ? (s.weight ?? 0) / total : 1 / n
    return out
  }

  const known = TABLES[fingerprintSteps(steps)]
  if (known) return known
  const w = 1 / n
  const out: Record<string, number> = {}
  for (const s of steps) out[s.phase] = w
  return out
}
