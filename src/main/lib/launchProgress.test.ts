import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createLaunchProgressTracker } from './launchProgress'
import { DEFAULT_LAUNCH_PHASES, buildLaunchPhases, AGENT_REQUIREMENTS_PHASE } from './launchPhases'

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'launch', 'first-run.log'),
  'utf-8'
)

interface Emit {
  phase: string
  status?: string
  percent?: number
  steps?: { phase: string; label: string }[]
}

/** Run a log through the tracker, fed as `chunks` slices. Returns every emit. */
function run(log: string, opts: { nodeCount?: number; chunks?: number } = {}): Emit[] {
  const emits: Emit[] = []
  const tracker = createLaunchProgressTracker({
    phases: DEFAULT_LAUNCH_PHASES,
    nodeCount: opts.nodeCount,
    sendProgress: (phase, detail) => emits.push({ phase, ...detail })
  })
  // Ensure a trailing newline so the final line is flushed (real logs always
  // end newline-terminated; an un-terminated tail legitimately stays buffered).
  const text = log.endsWith('\n') ? log : log + '\n'
  const chunkCount = opts.chunks ?? 1
  const size = Math.ceil(text.length / chunkCount)
  for (let i = 0; i < text.length; i += size) {
    tracker.ingest(text.slice(i, i + size))
  }
  return emits
}

/** The ordered list of distinct phase ids the tracker advanced through
 *  (ignores the initial 'steps' payload and repeated same-phase updates). */
function phaseOrder(emits: Emit[]): string[] {
  const out: string[] = []
  for (const e of emits) {
    if (e.phase === 'steps') continue
    if (out[out.length - 1] !== e.phase) out.push(e.phase)
  }
  return out
}

describe('createLaunchProgressTracker', () => {
  it('emits the steps payload once, up front', () => {
    const emits = run(FIXTURE)
    const steps = emits.filter((e) => e.phase === 'steps')
    expect(steps).toHaveLength(1)
    expect(steps[0]!.steps?.map((s) => s.phase)).toEqual(DEFAULT_LAUNCH_PHASES.map((p) => p.phase))
  })

  it('advances through the real phases in order', () => {
    const order = phaseOrder(run(FIXTURE))
    // Monotonic, in definition order, ending at startingServer.
    const idx = (p: string) => DEFAULT_LAUNCH_PHASES.findIndex((d) => d.phase === p)
    for (let i = 1; i < order.length; i++) {
      expect(idx(order[i]!)).toBeGreaterThanOrEqual(idx(order[i - 1]!))
    }
    expect(order).toContain('gpu')
    expect(order).toContain('startingServer')
    expect(order[order.length - 1]).toBe('startingServer')
  })

  it('re-observes phases for telemetry after resetPhaseObservation without regressing UI progress', () => {
    const emits: Emit[] = []
    const observed: string[] = []
    const tracker = createLaunchProgressTracker({
      phases: DEFAULT_LAUNCH_PHASES,
      sendProgress: (phase, detail) => emits.push({ phase, ...detail }),
      onPhaseEnter: (phase) => observed.push(phase)
    })
    tracker.start()
    tracker.ingest('Total VRAM 8192 MB\n')
    tracker.ingest('Starting server\n')
    expect(observed).toEqual(['launchStart', 'gpu', 'startingServer'])

    // Reboot retry: the respawned process re-logs its boot from the top. The
    // per-attempt buffer must see those milestones again...
    observed.length = 0
    const uiEmitsBefore = emits.length
    tracker.resetPhaseObservation()
    tracker.ingest('Total VRAM 8192 MB\n')
    tracker.ingest('Starting server\n')
    expect(observed).toEqual(['launchStart', 'gpu', 'startingServer'])
    // ...while the monotonic UI progress does not regress or re-emit entries.
    expect(emits.slice(uiEmitsBefore).every((e) => e.phase === 'startingServer')).toBe(true)
  })

  it('start() emits steps + the synthetic first phase active before any stdout', () => {
    const emits: Emit[] = []
    const tracker = createLaunchProgressTracker({
      phases: DEFAULT_LAUNCH_PHASES,
      sendProgress: (phase, detail) => emits.push({ phase, ...detail })
    })
    tracker.start()
    // steps payload first, then the first phase entered active — so the
    // renderer never sees a steps-but-no-active gap (which made the stepper
    // jump to the last step then jerk back to the first).
    expect(emits[0]?.phase).toBe('steps')
    expect(emits[1]?.phase).toBe(DEFAULT_LAUNCH_PHASES[0]!.phase)
    expect(emits[1]?.phase).toBe('launchStart')
    // Idempotent.
    const count = emits.length
    tracker.start()
    expect(emits.length).toBe(count)
  })

  it('captures VRAM into the gpu phase status', () => {
    const emits = run(FIXTURE)
    const gpu = emits.find((e) => e.phase === 'gpu')
    expect(gpu?.status).toMatch(/\d+\s*GB VRAM/)
  })

  it('is resilient to milestones split across chunks', () => {
    // 1-char chunks force every milestone line to be reassembled from the
    // pending buffer before matching.
    const order = phaseOrder(run(FIXTURE, { chunks: FIXTURE.length }))
    expect(order).toContain('gpu')
    expect(order[order.length - 1]).toBe('startingServer')
  })

  it('handles CRLF line endings (Windows)', () => {
    const crlf = FIXTURE.replace(/\n/g, '\r\n')
    const order = phaseOrder(run(crlf))
    expect(order).toContain('gpu')
    expect(order[order.length - 1]).toBe('startingServer')
  })

  it('counts custom nodes as "X of Y" when a denominator is known', () => {
    const log = [
      'Total VRAM 24576 MB, total RAM 24576 MB',
      'ComfyUI version: 0.21.1',
      'Import times for custom nodes:',
      '   0.0 seconds: /path/to/custom_nodes/node-a',
      '   0.1 seconds: /path/to/custom_nodes/node-b',
      'Starting server'
    ].join('\n')
    const emits = run(log, { nodeCount: 2 })
    const nodeEmits = emits.filter(
      (e) => e.phase === 'customNodes' && /\d+ \/ \d+/.test(e.status ?? '')
    )
    // Entry emits "0 / 2" at 0%, then counts up with the node name appended.
    expect(nodeEmits.map((e) => e.status)).toEqual(['0 / 2', '1 / 2 · node-a', '2 / 2 · node-b'])
    expect(nodeEmits.map((e) => e.percent)).toEqual([0, 50, 100])
  })

  it('translates recognized log signals into human i18n keys (never raw lines)', () => {
    const log = [
      'Total VRAM 24576 MB, total RAM 24576 MB',
      'Using sub quadratic optimization for attention'
    ].join('\n')
    const emits = run(log)
    // The raw line is NOT surfaced; a human i18n key is emitted instead.
    const streamed = emits.find(
      (e) => e.phase === 'gpu' && e.status === 'launch.activity.optimizing'
    )
    expect(streamed).toBeTruthy()
    expect(streamed?.percent).toBe(-1)
    // No emit ever carries the raw log text.
    expect(emits.some((e) => /sub quadratic/i.test(e.status ?? ''))).toBe(false)
  })

  it('skip-advances if a late milestone arrives before earlier ones', () => {
    // No security/gpu lines — jump straight to the server line.
    const order = phaseOrder(run('Starting server\nTo see the GUI go to: http://x\n'))
    expect(order).toEqual(['startingServer'])
  })

  it('never walks the phase index backward', () => {
    const log = [
      'Starting server', // jumps to last phase
      'Total VRAM 24576 MB' // earlier milestone arriving late — must NOT regress
    ].join('\n')
    const order = phaseOrder(run(log))
    expect(order).toEqual(['startingServer'])
  })

  it('advances correctly amid interleaved noise (no phantom jumps)', () => {
    // Real startup interleaves chatter between milestones. The phase matchers
    // are specific enough that unrelated lines don't trigger a premature
    // phase; real milestones still drive the order.
    const log = [
      'loading module comfy.foo',
      'Adding extra search path checkpoints /x', // securityScan
      'registry: checking server config',
      'some line mentioning the gui in passing',
      '[DONE] Security scan', // mountLibraries
      'torch backend probe',
      'Total VRAM 49152 MB, total RAM 49152 MB', // gpu
      'mps allocator init',
      'ComfyUI version: 0.24.1', // customNodes
      'frontend assets',
      'Starting server' // startingServer
    ].join('\n')
    const order = phaseOrder(run(log))
    expect(order).toEqual([
      'securityScan',
      'mountLibraries',
      'gpu',
      'customNodes',
      'startingServer'
    ])
  })
})

describe('DEFAULT_LAUNCH_PHASES', () => {
  it('weights sum to 1.0', () => {
    const sum = DEFAULT_LAUNCH_PHASES.reduce((a, p) => a + p.weight, 0)
    expect(sum).toBeCloseTo(1.0, 5)
  })
})

describe('buildLaunchPhases — extensibility', () => {
  it('returns the defaults unchanged when no pre-launch phases are injected', () => {
    expect(buildLaunchPhases({}).map((p) => p.phase)).toEqual(
      DEFAULT_LAUNCH_PHASES.map((p) => p.phase)
    )
  })

  it('injects a single pre-launch phase first', () => {
    expect(buildLaunchPhases({}, { preLaunchPhases: ['repair'] }).map((p) => p.phase)).toEqual([
      'repair',
      ...DEFAULT_LAUNCH_PHASES.map((p) => p.phase)
    ])
    expect(buildLaunchPhases({}, { preLaunchPhases: ['torchRepair'] })[0]!.phase).toBe(
      'torchRepair'
    )
  })

  it('injects multiple pre-launch phases in the given order (rollback, then torch)', () => {
    const phases = buildLaunchPhases({}, { preLaunchPhases: ['repair', 'torchRepair'] })
    expect(phases.slice(0, 2).map((p) => p.phase)).toEqual(['repair', 'torchRepair'])
    expect(phases.length).toBe(DEFAULT_LAUNCH_PHASES.length + 2)
    // Both carry a weight so the renderer can renormalize the bar (no 1/n fallback).
    expect(phases.every((p) => typeof p.weight === 'number' && p.weight > 0)).toBe(true)
  })

  it('drives the torchRepair step from torchRepair progress, completed by the first real milestone', () => {
    const phases = buildLaunchPhases({}, { preLaunchPhases: ['torchRepair'] })
    const emits: Emit[] = []
    const tracker = createLaunchProgressTracker({
      phases,
      sendProgress: (phase, detail) => emits.push({ phase, ...detail })
    })
    // Synthetic phase is entered up front (the repair finished before spawn).
    tracker.start()
    expect(emits[0]?.phase).toBe('steps')
    expect(emits[1]?.phase).toBe('torchRepair')
    // The first real boot milestone skip-advances past the synthetic step.
    tracker.ingest('Adding extra search path checkpoints /x\n[DONE] Security scan\n')
    const order = phaseOrder(emits)
    expect(order[0]).toBe('torchRepair')
    expect(order).toContain('securityScan')
    expect(order).toContain('mountLibraries')
  })
})

describe('addLatePhase for work discovered after the tracker was armed', () => {
  /** Arm a tracker over `phases` and return it with its emit log. */
  function armed(phases = buildLaunchPhases({}, { preLaunchPhases: ['torchRepair'] })): {
    tracker: ReturnType<typeof createLaunchProgressTracker>
    emits: Emit[]
  } {
    const emits: Emit[] = []
    const tracker = createLaunchProgressTracker({
      phases,
      sendProgress: (phase, detail) => emits.push({ phase, ...detail })
    })
    tracker.start()
    return { tracker, emits }
  }

  it('re-emits the steps payload so the renderer knows the new phase', () => {
    // Without the re-emit the renderer drops the phase's progress outright:
    // progressStore returns early when the phase is absent from `steps`.
    const { tracker, emits } = armed()
    const initial = emits
      .filter((e) => e.phase === 'steps')
      .at(-1)!
      .steps!.map((s) => s.phase)
    expect(initial).not.toContain('agentRequirements')

    tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)

    const stepPayloads = emits.filter((e) => e.phase === 'steps')
    expect(stepPayloads).toHaveLength(2)
    expect(stepPayloads[1]!.steps?.map((s) => s.phase)).toContain('agentRequirements')
  })

  it('enters the new phase, so it is the active step while the work runs', () => {
    const { tracker, emits } = armed()
    const before = emits.length

    tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)

    const after = emits.slice(before).filter((e) => e.phase !== 'steps')
    expect(after.map((e) => e.phase)).toEqual(['agentRequirements'])
    expect(after[0]!.percent).toBe(-1)
  })

  it('inserts directly after the active phase so the bar cannot regress', () => {
    // torchRepair is active (phase 0). The new phase must land at 1, ahead of
    // it and ahead of nothing already completed.
    const { tracker, emits } = armed()

    tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)

    const published = emits
      .filter((e) => e.phase === 'steps')
      .at(-1)!
      .steps!.map((s) => s.phase)
    expect(published.slice(0, 2)).toEqual(['torchRepair', 'agentRequirements'])
    expect(published).toEqual([
      'torchRepair',
      'agentRequirements',
      ...DEFAULT_LAUNCH_PHASES.map((p) => p.phase)
    ])
  })

  it('still advances into the real boot phases afterwards', () => {
    const { tracker, emits } = armed()
    tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)

    tracker.ingest('Total VRAM 24576 MB\n')

    expect(phaseOrder(emits).at(-1)).toBe('gpu')
  })

  it('works when nothing else injected a phase (the common launch)', () => {
    const { tracker, emits } = armed(buildLaunchPhases({}))

    tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)

    const published = emits
      .filter((e) => e.phase === 'steps')
      .at(-1)!
      .steps!.map((s) => s.phase)
    // launchStart is active at index 0, so the install lands right after it.
    expect(published.slice(0, 2)).toEqual(['launchStart', 'agentRequirements'])
    expect(phaseOrder(emits).at(-1)).toBe('agentRequirements')
  })

  it("does not mutate the caller's phase array", () => {
    const phases = buildLaunchPhases({})
    const { tracker } = armed(phases)
    const lengthBefore = phases.length

    tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)

    expect(phases).toHaveLength(lengthBefore)
    expect(phases.map((p) => p.phase)).not.toContain('agentRequirements')
  })
})
