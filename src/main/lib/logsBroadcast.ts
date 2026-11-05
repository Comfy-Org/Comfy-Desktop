import type { WebContents } from 'electron'
import { writeOperationOutput } from './appLog'

const MAX_BUFFER_CHARS = 256 * 1024

interface InstallLogState {
  buffer: string[]
  bufferSize: number
  subscribers: Set<WebContents>
}

const states = new Map<string, InstallLogState>()

function ensureState(installationId: string): InstallLogState {
  let s = states.get(installationId)
  if (!s) {
    s = { buffer: [], bufferSize: 0, subscribers: new Set() }
    states.set(installationId, s)
  }
  return s
}

function evictUntilBelowCap(state: InstallLogState): void {
  while (state.bufferSize > MAX_BUFFER_CHARS && state.buffer.length > 0) {
    const dropped = state.buffer.shift()!
    state.bufferSize -= dropped.length
  }
}

export function appendLog(installationId: string, text: string): void {
  if (!text) return
  writeOperationOutput(installationId, text)
  const state = ensureState(installationId)
  state.buffer.push(text)
  state.bufferSize += text.length
  evictUntilBelowCap(state)
  for (const wc of state.subscribers) {
    if (wc.isDestroyed()) {
      state.subscribers.delete(wc)
      continue
    }
    try {
      wc.send('logs-output', { installationId, text })
    } catch {}
  }
}

export interface LogsRestore {
  installationId: string
  buffer: string[]
}

export function subscribeLogs(installationId: string, wc: WebContents): LogsRestore {
  const state = ensureState(installationId)
  state.subscribers.add(wc)
  wc.once('destroyed', () => {
    state.subscribers.delete(wc)
  })
  return {
    installationId,
    buffer: state.buffer.slice()
  }
}

export function unsubscribeLogs(installationId: string, wc: WebContents): void {
  const state = states.get(installationId)
  if (!state) return
  state.subscribers.delete(wc)
}

export function getLogsBuffer(installationId: string): string[] {
  const state = states.get(installationId)
  if (!state) return []
  return state.buffer.slice()
}
