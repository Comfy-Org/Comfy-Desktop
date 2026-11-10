import type { ProgressStep } from '../types/ipc'

const TABLES: Record<string, Record<string, number>> = {
  'cleanup|download|extract|setup|update': {
    download: 0.4,
    extract: 0.2,
    setup: 0.3,
    cleanup: 0.05,
    update: 0.05
  },
  'cleanup|download|extract|restore-nodes|restore-pip|setup|update': {
    download: 0.3,
    extract: 0.15,
    setup: 0.2,
    cleanup: 0.05,
    update: 0.05,
    'restore-nodes': 0.15,
    'restore-pip': 0.1
  },
  'download|extract': {
    download: 0.7,
    extract: 0.3
  },
  'download|extract|models': {
    download: 0.65,
    extract: 0.15,
    models: 0.2
  },
  migration: {
    migration: 1.0
  },
  'migration|restore-nodes|restore-pip': {
    migration: 0.7,
    'restore-nodes': 0.18,
    'restore-pip': 0.12
  },
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

export function getPhaseWeights(steps: readonly ProgressStep[]): Record<string, number> {
  const n = steps.length
  if (n === 0) return {}

  if (steps.some((s) => s.weight !== undefined)) {
    const total = steps.reduce((a, s) => a + (s.weight ?? 0), 0)
    const out: Record<string, number> = {}
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
