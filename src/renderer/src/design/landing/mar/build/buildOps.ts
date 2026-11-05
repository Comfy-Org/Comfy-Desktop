import { reactive } from 'vue'
import { notify } from '../pages/undo'

/**
 * A build's long operation (update, copy, restore, migrate…), shown inside
 * the open tab in place of its content, as Desktop does: the title, a bar
 * with the step and percent, and Cancel; then done (back to the tab in a
 * moment), failed (Try Again, Dismiss) or cancelled (Dismiss). One at a
 * time per build. Its end is a toast too, for whoever left the tab.
 * Prototype timing.
 */
export interface BuildOp {
  title: string
  done: string
  step: string
  pct: number
  status: 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
  cancellable: boolean
  /** Fails once, so Try Again has something to do (Copy & Update). */
  failAt?: number
  then?: () => void
  timer?: ReturnType<typeof setInterval>
}

const OPS = reactive<Record<string, BuildOp | undefined>>({})

export const opOf = (id: string): BuildOp | undefined => OPS[id]

const STEPS = ['Preparing…', 'Downloading…', 'Installing packages…', 'Finishing…']

function tick(id: string): void {
  const op = OPS[id]
  if (!op) return
  op.timer = setInterval(() => {
    op.pct = Math.min(100, op.pct + 7)
    op.step = STEPS[Math.min(STEPS.length - 1, Math.floor(op.pct / 26))]!
    if (op.failAt !== undefined && op.pct >= op.failAt) {
      clearInterval(op.timer)
      op.status = 'failed'
      op.failAt = undefined
      if (op.error) notify(op.error, undefined, 'error')
      return
    }
    if (op.pct >= 100) {
      clearInterval(op.timer)
      op.status = 'done'
      op.then?.()
      notify(op.done)
      setTimeout(() => OPS[id] === op && delete OPS[id], 2400)
    }
  }, 160)
}

export function runOp(
  id: string,
  o: { title: string; done: string; cancellable?: boolean; fail?: string; then?: () => void }
): void {
  if (OPS[id]?.status === 'running') return
  OPS[id] = {
    title: o.title,
    done: o.done,
    step: STEPS[0]!,
    pct: 0,
    status: 'running',
    cancellable: o.cancellable ?? true,
    error: o.fail,
    failAt: o.fail ? 58 : undefined,
    then: o.then
  }
  tick(id)
}

export function cancelOp(id: string): void {
  const op = OPS[id]
  if (!op) return
  clearInterval(op.timer)
  op.status = 'cancelled'
}

export function retryOp(id: string): void {
  const op = OPS[id]
  if (!op) return
  op.status = 'running'
  op.pct = 0
  tick(id)
}

export function dismissOp(id: string): void {
  const op = OPS[id]
  if (op) clearInterval(op.timer)
  delete OPS[id]
}
