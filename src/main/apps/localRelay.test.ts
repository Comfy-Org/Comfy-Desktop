import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLocalRelay } from './localRelay'
import type { RelaySocket } from './localRelay'

class FakeSocket implements RelaySocket {
  closed = false
  private listeners = new Map<string, ((event: { data: unknown }) => void)[]>()

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.closed = true
  }

  emit(type: 'open' | 'close' | 'error' | 'message', data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
}

let sockets: FakeSocket[]
let heard: unknown[]

function relayUnderTest() {
  return createLocalRelay(
    (message) => heard.push(message),
    (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    }
  )
}

function lastSocket(): FakeSocket {
  const socket = sockets.at(-1)
  if (!socket) throw new Error('No socket was opened')
  return socket
}

beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  heard = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe("following a ComfyUI's socket", () => {
  it('connects as one client and hands over each message it can read', () => {
    const relay = relayUnderTest()

    relay.follow(8188)
    lastSocket().emit('open')
    lastSocket().emit('message', '{"type":"executing","data":{"node":"3"}}')
    lastSocket().emit('message', 'not json')
    lastSocket().emit('message', new ArrayBuffer(8))

    expect(sockets.map((socket) => socket.url)).toEqual([
      `ws://127.0.0.1:8188/ws?clientId=${relay.clientId}`
    ])
    expect(heard).toEqual([{ type: 'executing', data: { node: '3' } }])
  })

  it('keeps one connection while it is asked to follow the same ComfyUI again', () => {
    const relay = relayUnderTest()

    relay.follow(8188)
    relay.follow(8188)
    lastSocket().emit('open')
    relay.follow(8188)

    expect(sockets).toHaveLength(1)
  })

  it('connects again, waiting longer each time, while the ComfyUI is away', () => {
    const relay = relayUnderTest()
    relay.follow(8188)

    lastSocket().emit('error')
    lastSocket().emit('close')
    vi.advanceTimersByTime(999)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)

    lastSocket().emit('close')
    vi.advanceTimersByTime(1_999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)

    lastSocket().emit('open')
    lastSocket().emit('close')
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(4)
  })

  it('moves to another ComfyUI and ignores what the old connection still says', () => {
    const relay = relayUnderTest()
    relay.follow(8188)
    const old = lastSocket()
    old.emit('open')

    relay.follow(8190)
    old.emit('message', '{"type":"executing"}')
    old.emit('close')
    vi.advanceTimersByTime(60_000)

    expect(old.closed).toBe(true)
    expect(sockets.map((socket) => socket.url)).toEqual([
      `ws://127.0.0.1:8188/ws?clientId=${relay.clientId}`,
      `ws://127.0.0.1:8190/ws?clientId=${relay.clientId}`
    ])
    expect(heard).toEqual([])
  })

  it('stops for good when told to', () => {
    const relay = relayUnderTest()
    relay.follow(8188)
    const socket = lastSocket()

    relay.stop()
    socket.emit('close')
    vi.advanceTimersByTime(60_000)

    expect(socket.closed).toBe(true)
    expect(sockets).toHaveLength(1)
  })
})

describe('waiting for the socket to be open', () => {
  it('answers at once when it is', async () => {
    const relay = relayUnderTest()
    relay.follow(8188)
    lastSocket().emit('open')

    await expect(relay.whenOpen(5_000)).resolves.toBe(true)
  })

  it('answers as soon as it opens', async () => {
    const relay = relayUnderTest()
    relay.follow(8188)
    const waiting = relay.whenOpen(5_000)

    lastSocket().emit('open')

    await expect(waiting).resolves.toBe(true)
  })

  it('gives up after the wait, and when nothing is being followed', async () => {
    const relay = relayUnderTest()
    await expect(relay.whenOpen(5_000)).resolves.toBe(false)

    relay.follow(8188)
    const waiting = relay.whenOpen(5_000)
    vi.advanceTimersByTime(5_000)

    await expect(waiting).resolves.toBe(false)
  })

  it('gives up when the relay stops', async () => {
    const relay = relayUnderTest()
    relay.follow(8188)
    const waiting = relay.whenOpen(5_000)

    relay.stop()

    await expect(waiting).resolves.toBe(false)
  })
})
