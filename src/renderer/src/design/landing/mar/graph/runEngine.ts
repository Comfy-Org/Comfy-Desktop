import grass from '../assets/portrait-grass.jpg'
import seaside from '../assets/portrait-seaside.jpg'
import smile from '../assets/portrait-smile.jpg'
import sun from '../assets/portrait-sun.jpg'
import windowLight from '../assets/portrait-window.jpg'

/**
 * What the graph editor runs on. The UI only talks to `RunEngine`: it hands
 * over a snapshot of the graph, then listens. `createMockEngine` drives the
 * same events with timers so the mock feels real; a backend engine (a
 * ComfyUI prompt queue over its websocket) can replace it without touching
 * the UI.
 */

export type NodeRunState = 'idle' | 'queued' | 'running' | 'paused' | 'done' | 'error'

export interface RunNode {
  id: string
  kind: string
  title: string
  /** Its input sockets' names, in order. */
  ins: string[]
  /** The node's widget values when the run was queued. */
  params: Record<string, string>
}

export interface RunLink {
  from: string
  out: number
  to: string
  in: number
}

export interface RunGraph {
  /** Shown in the queue, e.g. the workflow's name. */
  title: string
  nodes: RunNode[]
  links: RunLink[]
}

/** What flows along a link, and what a node shows when it is done. */
export interface RunValue {
  src?: string
  text?: string
  /** Two pictures, for Compare. */
  pair?: [string, string]
  /** A picture with its background removed. */
  cutout?: boolean
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

export interface RunJob {
  id: string
  title: string
  /** Which run this is, counting from 1 in the session: results are tagged with it. */
  run: number
  status: JobStatus
  /** The whole run, 0 to 1. */
  progress: number
  /** The node being run, while running or paused. */
  nodeId?: string
}

export type RunEvent =
  | { type: 'job'; job: RunJob }
  | {
      type: 'node'
      jobId: string
      nodeId: string
      state: NodeRunState
      step?: number
      steps?: number
      error?: string
    }
  | { type: 'output'; jobId: string; run: number; nodeId: string; value: RunValue }
  | { type: 'removed'; jobId: string }

export interface RunEngine {
  /** Queues `count` runs of the graph; returns their ids. */
  queue(graph: RunGraph, count?: number): string[]
  /** Stops a run, running or waiting. */
  cancel(jobId: string): void
  /** Drops the runs still waiting; the running one goes on. */
  clearQueue(): void
  cancelAll(): void
  /** Holds a running job where it is (a Pause node also holds it). */
  pause(jobId: string): void
  resume(jobId: string): void
  on(listener: (e: RunEvent) => void): () => void
  dispose(): void
}

/** Runs the nodes in link order: every node after the ones feeding it. */
export function runOrder(graph: RunGraph): RunNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const out: RunNode[] = []
  const visit = (id: string): void => {
    if (seen.has(id) || !byId.has(id)) return
    seen.add(id)
    for (const l of graph.links) if (l.to === id) visit(l.from)
    out.push(byId.get(id)!)
  }
  for (const n of graph.nodes) visit(n.id)
  return out
}

// ── The mock. ──

/** Steps and time per step, by kind. Inputs and outputs pass in a beat. */
const PACE: Record<string, { steps: number; ms: number }> = {
  generate: { steps: 20, ms: 150 },
  generateVideo: { steps: 24, ms: 190 },
  generateAudio: { steps: 12, ms: 140 },
  llm: { steps: 8, ms: 160 },
  removeBg: { steps: 6, ms: 140 },
  upscale: { steps: 10, ms: 140 },
  workflow: { steps: 20, ms: 170 },
  output: { steps: 1, ms: 320 }
}
const QUICK = { steps: 1, ms: 220 }

/** Pictures the mock "makes", taken in turn so each run looks new. */
const GENERATED = [sun, smile, seaside, grass]
const RELIT = [windowLight, grass, smile, seaside]

/** What the mock's LLM writes, by task. */
function write(task: string, text: string): string {
  const t = text.trim().replace(/\.$/, '')
  if (task === 'Describe')
    return 'A young woman with auburn hair in a sunlit garden, white linen shirt, looking past the camera, soft warm backlight.'
  if (task === 'Shorten') return t.split(',')[0] ?? t
  return `${t || 'A portrait'}. Shot on 85 mm at f/1.8, warm rim light from the left, soft film grain, shallow depth of field.`
}

/** What each kind needs before it can run, by input index. */
const NEEDS: Record<string, { in: number; what: string; text?: boolean }[]> = {
  generate: [{ in: 0, what: 'a prompt', text: true }],
  generateAudio: [{ in: 0, what: 'some text', text: true }],
  llm: [{ in: 0, what: 'some text', text: true }],
  removeBg: [{ in: 0, what: 'an image' }],
  upscale: [{ in: 0, what: 'an image' }],
  workflow: [{ in: 0, what: 'an image' }],
  pause: [{ in: 0, what: 'an image' }],
  compare: [
    { in: 0, what: 'a before image' },
    { in: 1, what: 'an after image' }
  ],
  gallery: [{ in: 0, what: 'an image' }],
  output: [{ in: 0, what: 'an image' }]
}

interface MockJob extends RunJob {
  graph: RunGraph
  order: RunNode[]
  index: number
  step: number
  /** What each node made in this run. */
  values: Map<string, RunValue>
  /** Held by a Pause node, as opposed to by pause(). */
  atPause: boolean
}

export function createMockEngine(): RunEngine {
  const listeners = new Set<(e: RunEvent) => void>()
  const jobs: MockJob[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  let made = 0

  const emit = (e: RunEvent): void => listeners.forEach((l) => l(e))
  const publish = (j: MockJob): void =>
    emit({
      type: 'job',
      job: {
        id: j.id,
        title: j.title,
        run: j.run,
        status: j.status,
        progress: j.progress,
        nodeId: j.nodeId
      }
    })
  const nodeEvent = (
    j: MockJob,
    nodeId: string,
    state: NodeRunState,
    extra: { step?: number; steps?: number; error?: string } = {}
  ): void => emit({ type: 'node', jobId: j.id, nodeId, state, ...extra })

  const pace = (n: RunNode): { steps: number; ms: number } => PACE[n.kind] ?? QUICK
  const totalSteps = (j: MockJob): number => j.order.reduce((s, n) => s + pace(n).steps, 0)
  const stepsBefore = (j: MockJob): number =>
    j.order.slice(0, j.index).reduce((s, n) => s + pace(n).steps, 0)

  /** What reaches a node's input: the value of whatever is wired into it. */
  function input(j: MockJob, n: RunNode, i: number): RunValue | undefined {
    const l = j.graph.links.find((x) => x.to === n.id && x.in === i)
    return l ? j.values.get(l.from) : undefined
  }

  function finish(j: MockJob, status: JobStatus): void {
    clearTimeout(timer)
    timer = undefined
    j.status = status
    j.nodeId = undefined
    if (status === 'done') j.progress = 1
    publish(j)
    jobs.splice(jobs.indexOf(j), 1)
    emit({ type: 'removed', jobId: j.id })
    next()
  }

  /** Starts the next waiting job if nothing is running. */
  function next(): void {
    if (jobs.some((j) => j.status === 'running' || j.status === 'paused')) return
    const j = jobs.find((x) => x.status === 'queued')
    if (!j) return
    j.status = 'running'
    for (const n of j.order) nodeEvent(j, n.id, 'queued')
    enter(j)
  }

  function fail(j: MockJob, n: RunNode, error: string): void {
    nodeEvent(j, n.id, 'error', { error })
    for (const d of j.order.slice(j.index + 1)) nodeEvent(j, d.id, 'idle')
    finish(j, 'error')
  }

  function enter(j: MockJob): void {
    const n = j.order[j.index]
    if (!n) return finish(j, 'done')
    j.step = 0
    j.nodeId = n.id
    for (const need of NEEDS[n.kind] ?? []) {
      const v = input(j, n, need.in)
      if (!v) return fail(j, n, `Connect ${need.what}`)
      if (need.text && !v.text?.trim()) return fail(j, n, 'The prompt is empty')
    }
    if (n.kind === 'generateVideo' && !input(j, n, 0) && !input(j, n, 1))
      return fail(j, n, 'Connect a prompt or a first frame')
    if (n.kind === 'pause') {
      j.status = 'paused'
      j.atPause = true
      publish(j)
      nodeEvent(j, n.id, 'paused')
      return
    }
    nodeEvent(j, n.id, 'running', { step: 0, steps: pace(n).steps })
    publish(j)
    tick(j)
  }

  function tick(j: MockJob): void {
    const n = j.order[j.index]!
    const p = pace(n)
    timer = setTimeout(() => {
      j.step++
      j.progress = (stepsBefore(j) + j.step) / totalSteps(j)
      if (j.step < p.steps) {
        nodeEvent(j, n.id, 'running', { step: j.step, steps: p.steps })
        publish(j)
        return tick(j)
      }
      leave(j)
    }, p.ms)
  }

  /** What a node makes, from its inputs and its settings. */
  function make(j: MockJob, n: RunNode): RunValue {
    const a = input(j, n, 0)
    const b = input(j, n, 1)
    switch (n.kind) {
      case 'prompt':
        return { text: n.params.text }
      case 'image':
        return { src: n.params.image }
      case 'video':
        return { src: n.params.video }
      case 'audio':
        return { text: n.params.chip }
      case 'generate':
        return { src: GENERATED[made++ % GENERATED.length] }
      case 'generateVideo':
        return { src: b?.src ?? GENERATED[made++ % GENERATED.length] }
      case 'generateAudio':
        return { text: `${n.params.voice} · 0:0${4 + (made++ % 5)}` }
      case 'llm':
        return { text: write(n.params.task ?? 'Expand', a?.text ?? '') }
      case 'promptConstructor': {
        let text = n.params.text ?? ''
        n.ins.forEach((name, i) => {
          const v = input(j, n, i)?.text?.trim()
          if (v) text = text.replaceAll(`@${name}`, v)
        })
        return { text }
      }
      case 'removeBg':
        return { src: a?.src, cutout: true }
      case 'workflow':
        return { src: RELIT[made % RELIT.length], cutout: a?.cutout }
      case 'compare':
        return { pair: [a!.src!, b!.src!] }
      default:
        // Upscale, Pause, Gallery, Output: what came in goes on.
        return { ...a }
    }
  }

  function leave(j: MockJob): void {
    const n = j.order[j.index]!
    const value = make(j, n)
    j.values.set(n.id, value)
    emit({ type: 'output', jobId: j.id, run: j.run, nodeId: n.id, value })
    nodeEvent(j, n.id, 'done')
    j.index++
    enter(j)
  }

  return {
    queue(graph, count = 1) {
      const ids: string[] = []
      for (let i = 0; i < count; i++) {
        const j: MockJob = {
          id: `job-${++seq}`,
          title: graph.title,
          run: seq,
          status: 'queued',
          progress: 0,
          graph,
          order: runOrder(graph),
          index: 0,
          step: 0,
          values: new Map(),
          atPause: false
        }
        jobs.push(j)
        ids.push(j.id)
        publish(j)
      }
      next()
      return ids
    },
    cancel(jobId) {
      const j = jobs.find((x) => x.id === jobId)
      if (!j) return
      if (j.status === 'running' || j.status === 'paused') {
        // What it had not reached yet goes back to how it was.
        for (const n of j.order.slice(j.index)) nodeEvent(j, n.id, 'idle')
        finish(j, 'cancelled')
      } else {
        jobs.splice(jobs.indexOf(j), 1)
        emit({ type: 'removed', jobId })
      }
    },
    clearQueue() {
      for (const j of jobs.filter((x) => x.status === 'queued')) this.cancel(j.id)
    },
    cancelAll() {
      this.clearQueue()
      for (const j of [...jobs]) this.cancel(j.id)
    },
    pause(jobId) {
      const j = jobs.find((x) => x.id === jobId)
      if (!j || j.status !== 'running') return
      clearTimeout(timer)
      timer = undefined
      j.status = 'paused'
      publish(j)
    },
    resume(jobId) {
      const j = jobs.find((x) => x.id === jobId)
      if (!j || j.status !== 'paused') return
      j.status = 'running'
      if (j.atPause) {
        j.atPause = false
        j.progress = (stepsBefore(j) + 1) / totalSteps(j)
        return leave(j)
      }
      publish(j)
      tick(j)
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      clearTimeout(timer)
      jobs.length = 0
      listeners.clear()
    }
  }
}
