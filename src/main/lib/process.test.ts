import { describe, it, expect } from 'vitest'
import http from 'http'
import type { ChildProcess } from 'child_process'
import {
  findAvailablePort,
  isPortListening,
  killPidTree,
  isSafeToSignal,
  killProcessTree,
  spawnProcess,
  waitForPortFree,
  waitForPort,
  waitForUrl
} from './process'
import { isPidAlive, processGroupOf, readStartTimes } from './processIdentity'
import { vi } from 'vitest'
import net from 'net'

function listenOn(host: string, port: number = 0): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port })
      } else {
        reject(new Error('listen returned no address'))
      }
    })
  })
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function closeServers(servers: net.Server[]): Promise<void[]> {
  return Promise.all(servers.map(closeServer))
}

const MAX_PORT = 65535

const SEARCH_SPAN = 100

async function listenConsecutive(
  host: string,
  count: number,
  attempts = 50
): Promise<{ servers: net.Server[]; basePort: number }> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    const servers: net.Server[] = []
    try {
      const base = await listenOn(host)
      servers.push(base.server)
      if (base.port + SEARCH_SPAN <= MAX_PORT) {
        for (let offset = 1; offset < count; offset++) {
          servers.push((await listenOn(host, base.port + offset)).server)
        }
        return { servers, basePort: base.port }
      }
    } catch (err) {
      lastError = err
    }
    await closeServers(servers)
  }
  throw new Error(`could not bind ${count} consecutive ports on ${host}`, { cause: lastError })
}

describe('findAvailablePort', () => {
  it('finds an available port in the given range', async () => {
    const port = await findAvailablePort('127.0.0.1', 49200, 49300)

    expect(port).toBeGreaterThanOrEqual(49200)
    expect(port).toBeLessThanOrEqual(49300)
  })

  it('skips ports in the excludePorts set', async () => {
    const firstPort = await findAvailablePort('127.0.0.1', 49200, 49300)

    const excluded = new Set([firstPort])
    const result = await findAvailablePort('127.0.0.1', firstPort, 49300, excluded)

    expect(result).not.toBe(firstPort)
    expect(result).toBeGreaterThanOrEqual(firstPort + 1)
  })

  it('skips multiple excluded ports', async () => {
    const base = 49300
    const excluded = new Set([base, base + 1, base + 2])
    const result = await findAvailablePort('127.0.0.1', base, base + 100, excluded)

    expect(excluded.has(result)).toBe(false)
    expect(result).toBeGreaterThanOrEqual(base + 3)
  })

  it('rejects when all ports in range are excluded', async () => {
    const base = 49400
    const excluded = new Set([base, base + 1, base + 2])

    await expect(findAvailablePort('127.0.0.1', base, base + 2, excluded)).rejects.toThrow(
      'No available ports found'
    )
  })

  it('skips a port that is actually in use', async () => {
    const { servers, basePort } = await listenConsecutive('127.0.0.1', 1)

    try {
      const result = await findAvailablePort('127.0.0.1', basePort, basePort + SEARCH_SPAN)
      expect(result).toBeGreaterThan(basePort)
    } finally {
      await closeServers(servers)
    }
  })

  it('skips multiple sequentially-busy ports', async () => {
    const { servers, basePort } = await listenConsecutive('127.0.0.1', 2)
    try {
      const result = await findAvailablePort('127.0.0.1', basePort, basePort + SEARCH_SPAN)
      expect(result).toBeGreaterThanOrEqual(basePort + 2)
    } finally {
      await closeServers(servers)
    }
  })

  it('skips a port occupied by a wildcard 0.0.0.0 listener', async () => {
    const { servers, basePort } = await listenConsecutive('0.0.0.0', 1)
    try {
      const result = await findAvailablePort('127.0.0.1', basePort, basePort + SEARCH_SPAN)
      expect(result).toBeGreaterThan(basePort)
    } finally {
      await closeServers(servers)
    }
  })
})

describe('isPortListening', () => {
  it('returns true for a port bound on the same host', async () => {
    const { server, port } = await listenOn('127.0.0.1')
    try {
      expect(await isPortListening(port, '127.0.0.1')).toBe(true)
    } finally {
      await closeServer(server)
    }
  })

  it('returns true for a port bound on the wildcard interface', async () => {
    const { server, port } = await listenOn('0.0.0.0')
    try {
      expect(await isPortListening(port, '127.0.0.1')).toBe(true)
    } finally {
      await closeServer(server)
    }
  })

  it('returns false for a port that nothing owns', async () => {
    const { server, port } = await listenOn('127.0.0.1')
    await closeServer(server)
    expect(await isPortListening(port, '127.0.0.1')).toBe(false)
  })
})

function listenHanging(): Promise<{ close: () => Promise<void>; port: number }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve({
          port: addr.port,
          close: () => {
            for (const socket of sockets) socket.destroy()
            return closeServer(server)
          }
        })
      } else {
        reject(new Error('listen returned no address'))
      }
    })
  })
}

describe('waitForPort abort settlement', () => {
  it('rejects promptly when aborted while a request is in flight', async () => {
    const { close, port } = await listenHanging()
    const controller = new AbortController()
    try {
      const wait = waitForPort(port, '127.0.0.1', {
        timeoutMs: 600_000,
        requestTimeoutMs: 600_000,
        intervalMs: 100,
        signal: controller.signal
      })
      setTimeout(() => controller.abort(), 50)
      await expect(wait).rejects.toThrow('Launch cancelled.')
    } finally {
      await close()
    }
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      waitForPort(1, '127.0.0.1', { timeoutMs: 30000, signal: controller.signal })
    ).rejects.toThrow('Launch cancelled.')
  })
})

describe('waitForUrl abort settlement', () => {
  it('rejects promptly when aborted while a request is in flight', async () => {
    const { close, port } = await listenHanging()
    const controller = new AbortController()
    try {
      const wait = waitForUrl(`http://127.0.0.1:${port}/`, {
        timeoutMs: 600_000,
        requestTimeoutMs: 600_000,
        intervalMs: 100,
        signal: controller.signal
      })
      setTimeout(() => controller.abort(), 50)
      await expect(wait).rejects.toThrow('Launch cancelled.')
    } finally {
      await close()
    }
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      waitForUrl('http://127.0.0.1:1/', { timeoutMs: 30000, signal: controller.signal })
    ).rejects.toThrow('Launch cancelled.')
  })
})

describe('waitForPortFree', () => {
  it('waits out a socket that is released a moment after its owner is gone', async () => {
    const { server, port } = await listenOn('127.0.0.1')
    setTimeout(() => server.close(), 150)
    const started = Date.now()
    expect(await waitForPortFree(port, '127.0.0.1', 2_000, 20)).toBe(true)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    expect(await isPortListening(port)).toBe(false)
  })

  it('keeps its bound when the wall clock stands still (monotonic deadline)', async () => {
    const { server, port } = await listenOn('127.0.0.1')
    const frozen = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      expect(await waitForPortFree(port, '127.0.0.1', 150, 20)).toBe(false)
    } finally {
      frozen.mockRestore()
      await closeServer(server)
    }
  })

  it('gives up at its bound when the port stays held', async () => {
    const { server, port } = await listenOn('127.0.0.1')
    try {
      expect(await waitForPortFree(port, '127.0.0.1', 150, 20)).toBe(false)
    } finally {
      await closeServer(server)
    }
  })
})

describe.runIf(process.platform !== 'win32')('kills that wait for exit (real processes)', () => {
  const TREE = `
    const { spawn } = require('child_process')
    const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    console.log(c.pid)
    setTimeout(() => {}, 60000)
  `

  async function spawnTree(): Promise<{ proc: ChildProcess; grandchild: number }> {
    const proc = spawnProcess(process.execPath, ['-e', TREE], process.cwd())
    const grandchild = await new Promise<number>((resolve) => {
      proc.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim())))
    })
    return { proc, grandchild }
  }

  function cleanup(pid: number): void {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
  }

  it('killProcessTree reports exited only once the whole group is gone', async () => {
    const { proc, grandchild } = await spawnTree()
    try {
      const result = await killProcessTree(proc)
      expect(result.exited).toBe(true)
      expect(isPidAlive(grandchild)).toBe(false)
    } finally {
      cleanup(proc.pid!)
    }
  })

  it('killPidTree stops an unowned tree when the start time still matches', async () => {
    const { proc, grandchild } = await spawnTree()
    try {
      const start = (await readStartTimes([proc.pid!]))!.get(proc.pid!)!
      const result = await killPidTree(proc.pid!, start)
      expect(result).toMatchObject({ killed: true, exited: true })
      expect(isPidAlive(grandchild)).toBe(false)
      expect(result.killed && result.members).toEqual(
        expect.arrayContaining([proc.pid!, grandchild])
      )
    } finally {
      cleanup(proc.pid!)
    }
  })

  it('killPidTree never signals a pid whose start time no longer matches', async () => {
    const { proc } = await spawnTree()
    try {
      const result = await killPidTree(proc.pid!, 'a-process-that-had-this-pid-before')
      expect(result.killed).toBe(false)
      expect(isPidAlive(proc.pid!)).toBe(true)
    } finally {
      cleanup(proc.pid!)
    }
  })
})

describe('isSafeToSignal (never signal what a forged record names)', () => {
  it.each([0, 1, -5, 1.5])('refuses pid %s', async (pid) => {
    expect(await isSafeToSignal(pid)).toBe(false)
  })

  it('refuses this Desktop', async () => {
    expect(await isSafeToSignal(process.pid)).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('refuses our own process group', async () => {
    const own = await processGroupOf(process.pid)
    expect(own).not.toBeNull()
    expect(await isSafeToSignal(own!)).toBe(false)
  })

  it.runIf(process.platform !== 'win32')(
    'killPidTree refuses pid 1 before reading or signalling anything',
    async () => {
      const result = await killPidTree(1, 'whatever-token')
      expect(result).toMatchObject({ killed: false, reason: 'unsafe' })
    }
  )
})

describe('requestTimeoutMs reaches the probe request', () => {
  it.each([
    ['waitForPort', 1234, 1234],
    ['waitForPort', undefined, 2000],
    ['waitForPort', Number.NaN, 2000],
    ['waitForPort', -5, 2000],
    ['waitForUrl', 1234, 1234],
    ['waitForUrl', undefined, 2000],
    ['waitForUrl', Number.POSITIVE_INFINITY, 2000]
  ] as const)('%s with %s', async (fn, requestTimeoutMs, expected) => {
    const { close, port } = await listenHanging()
    const get = vi.spyOn(http, 'get')
    const controller = new AbortController()
    try {
      const opts = {
        timeoutMs: 600_000,
        intervalMs: 100,
        signal: controller.signal,
        ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {})
      }
      const wait =
        fn === 'waitForPort'
          ? waitForPort(port, '127.0.0.1', opts)
          : waitForUrl(`http://127.0.0.1:${port}/`, opts)
      wait.catch(() => {})
      await vi.waitFor(() => expect(get).toHaveBeenCalled())
      const timeouts = get.mock.calls.map(
        (call) =>
          call.find(
            (arg): arg is { timeout: number } =>
              typeof arg === 'object' && arg !== null && 'timeout' in arg
          )?.timeout
      )
      expect(timeouts).toContain(expected)
      controller.abort()
      await expect(wait).rejects.toThrow('Launch cancelled.')
    } finally {
      controller.abort()
      get.mockRestore()
      await close()
    }
  })
})

describe('a probe never outlasts the overall deadline', () => {
  it.each(['waitForPort', 'waitForUrl'] as const)('%s', async (fn) => {
    const { close, port } = await listenHanging()
    const get = vi.spyOn(http, 'get')
    const controller = new AbortController()
    try {
      const opts = {
        timeoutMs: 3_000,
        requestTimeoutMs: 600_000,
        intervalMs: 100,
        signal: controller.signal
      }
      const wait =
        fn === 'waitForPort'
          ? waitForPort(port, '127.0.0.1', opts)
          : waitForUrl(`http://127.0.0.1:${port}/`, opts)
      wait.catch(() => {})
      await vi.waitFor(() => expect(get).toHaveBeenCalled())
      const timeout = get.mock.calls[0]!.find(
        (arg): arg is { timeout: number } =>
          typeof arg === 'object' && arg !== null && 'timeout' in arg
      )?.timeout
      expect(timeout).toBeGreaterThan(0)
      expect(timeout).toBeLessThanOrEqual(3_000)
      controller.abort()
      await expect(wait).rejects.toThrow('Launch cancelled.')
    } finally {
      controller.abort()
      get.mockRestore()
      await close()
    }
  })
})

describe('a spent budget still ends the wait', () => {
  it.each(['waitForPort', 'waitForUrl'] as const)('%s with timeoutMs 0', async (fn) => {
    const { close, port } = await listenHanging()
    try {
      const opts = { timeoutMs: 0, intervalMs: 10 }
      const wait =
        fn === 'waitForPort'
          ? waitForPort(port, '127.0.0.1', opts)
          : waitForUrl(`http://127.0.0.1:${port}/`, opts)
      await expect(wait).rejects.toThrow('Timed out')
    } finally {
      await close()
    }
  })
})
