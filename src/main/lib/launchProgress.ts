import type { LaunchPhaseDef } from './launchPhases'

const NODE_IMPORT_LINE = /^\s*[\d.]+\s*seconds?:\s*.*[/\\]custom_nodes[/\\](.+?)[/\\]?$/i

const ACTIVITY_MESSAGES: ReadonlyArray<{ match: RegExp; key: string }> = [
  { match: /\[(?:PRE|START)\] ComfyUI-Manager|ComfyUI-Manager/i, key: 'launch.activity.manager' },
  {
    match: /FETCH ComfyRegistry|custom-node-list|api\.comfy\.org\/nodes/i,
    key: 'launch.activity.registry'
  },
  { match: /Set vram state|Device:\s|VRAM/i, key: 'launch.activity.vram' },
  {
    match: /pytorch version|optimization for attention|xformers|sage-attention|flash-attention/i,
    key: 'launch.activity.optimizing'
  },
  {
    match: /Checkpoint files will always|model path|Adding extra search path/i,
    key: 'launch.activity.models'
  },
  { match: /Database|alembic|Running upgrade|SQLite/i, key: 'launch.activity.database' },
  {
    match: /Import times for custom nodes|Loading custom node|Loaded node/i,
    key: 'launch.activity.nodes'
  }
]

function activityKeyFor(line: string): string | null {
  for (const entry of ACTIVITY_MESSAGES) {
    if (entry.match.test(line)) return entry.key
  }
  return null
}

export interface LaunchProgressTracker {
  start: () => void
  ingest: (chunk: string) => void
  addLatePhase: (def: LaunchPhaseDef) => void
  resetPhaseObservation: () => void
}

export function createLaunchProgressTracker(opts: {
  phases: readonly LaunchPhaseDef[]
  nodeCount?: number
  sendProgress: (phase: string, detail: Record<string, unknown>) => void
  onPhaseEnter?: (phase: string) => void
}): LaunchProgressTracker {
  const { sendProgress, onPhaseEnter } = opts
  const phases = [...opts.phases]
  const nodeCount = opts.nodeCount && opts.nodeCount > 0 ? opts.nodeCount : 0

  let activeIdx = -1
  let observedPhases = new Set<string>()

  function observePhase(phase: string): void {
    if (observedPhases.has(phase)) return
    observedPhases.add(phase)
    if (onPhaseEnter) {
      try {
        onPhaseEnter(phase)
      } catch {}
    }
  }
  let nodesSeen = 0
  let stepsSent = false
  let vramGb: number | null = null

  function emitSteps(): void {
    if (stepsSent) return
    stepsSent = true
    sendProgress('steps', {
      steps: phases.map((p) => ({ phase: p.phase, label: p.phase, weight: p.weight }))
    })
  }

  function enterPhase(idx: number): void {
    if (idx <= activeIdx) return
    activeIdx = idx
    const def = phases[idx]!
    observePhase(def.phase)
    sendProgress(def.phase, {
      status: entryStatus(def),
      percent: entryPercent(def)
    })
  }

  function entryPercent(def: LaunchPhaseDef): number {
    if (def.streaming) return -1
    if (def.phase === 'customNodes' && nodeCount > 0) return 0
    return 100
  }

  function entryStatus(def: LaunchPhaseDef): string {
    if (def.phase === 'gpu' && vramGb !== null) return `${vramGb} GB VRAM`
    if (def.phase === 'customNodes' && nodeCount > 0) return nodeCountLabel()
    return ''
  }

  function nodeCountLabel(): string {
    return `${Math.min(nodesSeen, nodeCount)} / ${nodeCount}`
  }

  function handleLine(rawLine: string): void {
    const line = rawLine.trimEnd()
    if (line.trim().length === 0) return

    emitSteps()

    for (let i = phases.length - 1; i > activeIdx; i--) {
      const def = phases[i]!
      const m = line.match(def.match)
      if (!m) continue
      if (def.phase === 'gpu' && m[1]) {
        const mb = Number(m[1])
        if (Number.isFinite(mb) && mb > 0) vramGb = Math.round(mb / 1024)
      }
      enterPhase(i)
      break
    }

    for (let i = Math.min(activeIdx, phases.length - 1); i >= 0; i--) {
      const def = phases[i]!
      if (observedPhases.has(def.phase)) continue
      if (!def.match.test(line)) continue
      observePhase(def.phase)
      break
    }

    if (activeIdx < 0) return
    const def = phases[activeIdx]!

    if (def.phase === 'customNodes' && nodeCount > 0) {
      const nodeMatch = line.match(NODE_IMPORT_LINE)
      if (nodeMatch) {
        nodesSeen++
        const pct = Math.min(100, Math.round((nodesSeen / nodeCount) * 100))
        const name = nodeMatch[1]?.replace(/\.py$/, '') ?? ''
        sendProgress(def.phase, {
          status: name ? `${nodeCountLabel()} · ${name}` : nodeCountLabel(),
          percent: pct
        })
        return
      }
    }

    if (def.streaming) {
      const key = activityKeyFor(line)
      if (key) sendProgress(def.phase, { status: key, percent: -1 })
    }
  }

  let pending = ''
  return {
    start(): void {
      emitSteps()
      if (activeIdx < 0 && phases.length > 0) enterPhase(0)
    },
    resetPhaseObservation(): void {
      observedPhases = new Set()
      if (activeIdx >= 0 && phases.length > 0) observePhase(phases[0]!.phase)
    },
    ingest(chunk: string): void {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    },
    addLatePhase(def: LaunchPhaseDef): void {
      const idx = activeIdx + 1
      phases.splice(idx, 0, { ...def })
      stepsSent = false
      emitSteps()
      enterPhase(idx)
    }
  }
}
