import type { WebContents } from 'electron'

import { buildCancelCleanupScript } from './injectScript'

export const PARTITION_LOCK_TIMEOUT_MS = 30_000

interface ActiveCleanup {
  contents: WebContents
  token: string
}

interface PartitionState {
  tail: Promise<void>
  epoch: number
  cleanup: ActiveCleanup | null
  signingIn: boolean
}

const partitions = new WeakMap<object, PartitionState>()

function stateFor(contents: WebContents): PartitionState {
  const key = contents.session
  let state = partitions.get(key)
  if (!state) {
    state = { tail: Promise.resolve(), epoch: 0, cleanup: null, signingIn: false }
    partitions.set(key, state)
  }
  return state
}

function settledOrTimedOut(run: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, PARTITION_LOCK_TIMEOUT_MS)
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    run.then(done, done)
  })
}

export function runOnPartition<T>(contents: WebContents, fn: () => Promise<T>): Promise<T> {
  const state = stateFor(contents)
  const run = state.tail.then(fn)
  state.tail = settledOrTimedOut(run)
  return run
}

export function partitionEpoch(contents: WebContents): number {
  return stateFor(contents).epoch
}

export function trackPartitionCleanup(contents: WebContents, token: string): () => void {
  const state = stateFor(contents)
  const cleanup = { contents, token }
  state.cleanup = cleanup
  return () => {
    if (state.cleanup === cleanup) state.cleanup = null
  }
}

export function preemptPartitionCleanup(contents: WebContents): void {
  const state = stateFor(contents)
  state.epoch += 1
  const cleanup = state.cleanup
  if (!cleanup || cleanup.contents.isDestroyed()) return
  void cleanup.contents.executeJavaScript(buildCancelCleanupScript(cleanup.token)).catch(() => {})
}

export function claimPartitionSignIn(contents: WebContents): (() => void) | null {
  const state = stateFor(contents)
  if (state.signingIn) return null
  state.signingIn = true
  return () => {
    state.signingIn = false
  }
}
