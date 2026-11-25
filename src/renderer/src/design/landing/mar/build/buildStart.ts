import { computed, reactive } from 'vue'

/**
 * State behind Build › Get started, in memory. Each action is the seam a
 * real backend plugs into:
 *  - createKey()   → platform.comfy.org creates a `comfyui-…` key
 *  - listen()      → Desktop watches its local server (POST /prompt) or
 *                    the comfy-mcp stdio handshake for the first call
 *  - receive()     → that first call, as a Request log row
 * Nothing here persists: reloading starts over, which is what a demo wants.
 */

export type Path = 'agent' | 'python' | 'js' | 'curl'
export type AgentClient = 'claude' | 'json'

export interface ApiKey {
  name: string
  value: string
  created: string
}

export interface FirstRequest {
  method: string
  path: string
  status: string
  ms: number
  detail: string
  when: string
}

export const start = reactive({
  path: 'agent' as Path,
  agentClient: 'claude' as AgentClient,
  key: null as ApiKey | null,
  creatingKey: false,
  /** Open models only: no key needed, so the step can be passed. */
  skippedKey: false,
  revealed: false,
  /** The code or prompt was copied: the page starts waiting for a call. */
  copied: false,
  first: null as FirstRequest | null
})

/** Server address of the local build the samples talk to. */
export const HOST = 'http://127.0.0.1:8188'

const HEX = '0123456789abcdef'
function hex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += HEX[Math.floor(Math.random() * 16)]
  return s
}

export function createKey(): void {
  if (start.creatingKey) return
  start.creatingKey = true
  // Stands in for the platform round trip.
  setTimeout(() => {
    start.key = { name: 'Desktop · first key', value: `comfyui-${hex(40)}`, created: 'Just now' }
    start.creatingKey = false
    start.revealed = true
  }, 650)
}

export function revokeKey(): void {
  start.key = null
  start.revealed = false
  start.skippedKey = false
  start.first = null
  start.copied = false
}

/** Masked form: prefix and last four, the rest as dots. */
export const masked = computed(() =>
  start.key ? `comfyui-${'•'.repeat(12)}${start.key.value.slice(-4)}` : ''
)

let timer: ReturnType<typeof setTimeout> | undefined

/** After a copy, a call shows up a few seconds later (the mock). */
export function markCopied(): void {
  start.copied = true
  if (start.first) return
  clearTimeout(timer)
  timer = setTimeout(receive, 4200)
}

export function receive(): void {
  clearTimeout(timer)
  start.copied = true
  start.first =
    start.path === 'agent'
      ? {
          method: 'MCP',
          path: 'comfy-mcp',
          status: 'OK',
          ms: 38,
          detail: start.agentClient === 'claude' ? 'Claude Code connected' : 'Cursor connected',
          when: 'just now'
        }
      : {
          method: 'POST',
          path: '/prompt',
          status: '200',
          ms: 142,
          detail: `prompt_id ${hex(8)}-${hex(4)}`,
          when: 'just now'
        }
}

export function resetStart(): void {
  clearTimeout(timer)
  start.first = null
  start.copied = false
}

/** Three steps: a key, the call, the call arriving. */
export const stepsDone = computed(() => [
  Boolean(start.key) || start.skippedKey,
  start.copied,
  Boolean(start.first)
])
export const current = computed(() => {
  const i = stepsDone.value.indexOf(false)
  return i === -1 ? 3 : i
})
