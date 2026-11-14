import { randomUUID } from 'crypto'

const FIRST_RETRY_MS = 1_000
const LONGEST_RETRY_MS = 30_000

export interface RelaySocket {
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  close(): void
}

export interface LocalRelay {
  readonly clientId: string
  follow(port: number): void
  whenOpen(timeoutMs: number): Promise<boolean>
  stop(): void
}

function parseMessage(data: unknown): unknown {
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function createLocalRelay(
  onMessage: (message: unknown) => void,
  openSocket: (url: string) => RelaySocket = (url) => new WebSocket(url)
): LocalRelay {
  const clientId = randomUUID()
  let followedPort: number | null = null
  let socket: RelaySocket | null = null
  let isOpen = false
  let retryMs = FIRST_RETRY_MS
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let waiters: ((open: boolean) => void)[] = []

  function tellWaiters(open: boolean): void {
    const waiting = waiters
    waiters = []
    for (const tell of waiting) tell(open)
  }

  function forget(): void {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    const closing = socket
    socket = null
    isOpen = false
    closing?.close()
  }

  function connect(port: number): void {
    const connecting = openSocket(`ws://127.0.0.1:${port}/ws?clientId=${clientId}`)
    socket = connecting
    connecting.addEventListener('open', () => {
      if (socket !== connecting) return
      isOpen = true
      retryMs = FIRST_RETRY_MS
      tellWaiters(true)
    })
    connecting.addEventListener('message', (event) => {
      if (socket !== connecting) return
      const message = parseMessage(event.data)
      if (message !== null) onMessage(message)
    })
    const retryLater = (): void => {
      if (socket !== connecting) return
      socket = null
      isOpen = false
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (followedPort === port) connect(port)
      }, retryMs)
      retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS)
    }
    connecting.addEventListener('close', retryLater)
    connecting.addEventListener('error', retryLater)
  }

  return {
    clientId,
    follow(port) {
      if (followedPort === port) return
      forget()
      followedPort = port
      retryMs = FIRST_RETRY_MS
      connect(port)
    },
    whenOpen(timeoutMs) {
      if (isOpen) return Promise.resolve(true)
      if (followedPort === null) return Promise.resolve(false)
      return new Promise((resolve) => {
        const tell = (open: boolean): void => {
          clearTimeout(timer)
          resolve(open)
        }
        const timer = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter !== tell)
          resolve(false)
        }, timeoutMs)
        waiters.push(tell)
      })
    },
    stop() {
      followedPort = null
      forget()
      tellWaiters(false)
    }
  }
}
