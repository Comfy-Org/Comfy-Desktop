import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ root: '', output: '', sessions: new Map() }))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  protocol: { handle: vi.fn() }
}))
vi.mock('./paths', () => ({ stateDir: () => state.root }))
vi.mock('../settings', () => ({
  get: () => state.output,
  defaults: { outputDir: '' }
}))
vi.mock('../installations', () => ({
  list: async () =>
    ['a', 'b'].map((id) => ({ id, sourceId: 'standalone', installPath: state.root }))
}))
vi.mock('./ipc/shared', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    _runningSessions: state.sessions,
    sessionLifecycleEvents: new EventEmitter(),
    sourceMap: { standalone: { category: 'local' } }
  }
})
vi.mock('./models', () => ({ installOutputDir: () => state.output }))
vi.mock('./assets', () => ({ assetKind: () => 'image' }))

import { listLocalAssets, registerOutputFolderHandlers } from './outputFolders'
import { sessionLifecycleEvents } from './ipc/shared'

async function startServer() {
  const sockets = new Set<Duplex>()
  const history: Record<string, unknown> = {}
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(history))
  })

  function status(): void {
    const payload = Buffer.from(JSON.stringify({ type: 'status', data: {} }))
    const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload])
    for (const socket of sockets) socket.write(frame)
  }

  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    sockets.add(socket)
    socket.on('data', () => {})
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    status()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    history,
    requests,
    sockets,
    status,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

let a: Awaited<ReturnType<typeof startServer>>
let b: Awaited<ReturnType<typeof startServer>>

beforeAll(async () => {
  state.root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'provenance-api-')))
  state.output = path.join(state.root, 'output')
  await fs.mkdir(state.output)
  a = await startServer()
  b = await startServer()
  registerOutputFolderHandlers()
})

afterAll(async () => {
  state.sessions.clear()
  sessionLifecycleEvents.emit('changed')
  await a?.close()
  await b?.close()
  await fs.rm(state.root, { recursive: true, force: true })
})

it('captures API outputs in the background and filters stopped builds that shared a folder', async () => {
  state.sessions.set('a', { port: a.port })
  state.sessions.set('b', { port: b.port })
  sessionLifecycleEvents.emit('changed')
  await vi.waitFor(() => {
    expect(a.sockets.size).toBe(1)
    expect(b.sockets.size).toBe(1)
  })

  const start = Date.now()
  await fs.writeFile(path.join(state.output, 'a.png'), 'a')
  await fs.writeFile(path.join(state.output, 'b.png'), 'b')
  await fs.writeFile(path.join(state.output, 'legacy.png'), 'legacy')
  for (const [id, server] of [
    ['a', a],
    ['b', b]
  ] as const) {
    server.history[id] = {
      status: {
        messages: [
          ['execution_start', { timestamp: start }],
          ['execution_success', { timestamp: Date.now() }]
        ]
      },
      outputs: { save: { images: [{ filename: `${id}.png`, subfolder: '', type: 'output' }] } }
    }
    server.status()
  }

  await vi.waitFor(async () => {
    const saved = JSON.parse(
      await fs.readFile(path.join(state.root, 'asset-provenance.json'), 'utf8')
    )
    expect(Object.values(saved.files)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ installationId: 'a' }),
        expect.objectContaining({ installationId: 'b' })
      ])
    )
  })
  state.sessions.clear()
  sessionLifecycleEvents.emit('changed')
  await vi.waitFor(() => {
    expect(a.requests).toContain('/history?max_items=1000')
    expect(b.requests).toContain('/history?max_items=1000')
  })

  expect((await listLocalAssets('a')).map((asset) => asset.name)).toEqual(['a.png'])
  expect((await listLocalAssets('b')).map((asset) => asset.name)).toEqual(['b.png'])
  expect((await listLocalAssets()).map((asset) => asset.name).sort()).toEqual([
    'a.png',
    'b.png',
    'legacy.png'
  ])
})
