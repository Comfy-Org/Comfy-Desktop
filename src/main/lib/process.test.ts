import { describe, it, expect } from 'vitest'
import http from 'http'
import type { ChildProcess } from 'child_process'
import {
  findAvailablePort,
  isPortListening,
  killPidTree,
  isSafeToSignal,
  killProcessTree,
  setPortArg,
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

/** Highest valid TCP port. Nothing above this can be bound or probed. */
const MAX_PORT = 65535

/** How far above a held run these tests let `findAvailablePort` search. */
const SEARCH_SPAN = 100

/**
 * Bind `count` consecutive ports, letting the OS pick the base, and keep the
 * whole `SEARCH_SPAN` window above it inside the valid port space.
 *
 * Hardcoding the base is a flake: the ephemeral range (32768-60999 on Linux,
 * 49152-65535 on Windows and macOS) swallows the "high" ports a test is
 * tempted to pick, so any transient outbound connection can already own one
 * and the bind dies with EADDRINUSE. Port 0 hands back something the OS knows
 * is free, and we keep holding it.
 *
 * Two ways an OS-assigned base is still unusable, both re-asked rather than
 * failed. A neighbour above it may be taken. Or the base may sit so close to
 * MAX_PORT that the search window runs off the end of the port space - on the
 * ranges that reach 65535 (Windows, macOS) `listen(0)` really can return it,
 * and `isPortListening` reports every out-of-range port as *unavailable*
 * (`canBind` catches the throw and resolves false), so the search would walk
 * to the end of the range and fail with "No available ports found" instead of
 * landing.
 */
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
      // Usually a neighbour taken between the base bind and this one, which is
      // worth another base. Keep it anyway: a deterministic failure (EACCES,
      // say) otherwise burns every attempt and surfaces as a bare "could not
      // bind", with the one useful detail thrown away 50 times.
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

  // Regression for #806: when a port is reported "free" by a flawed
  // single-bind probe but is actually owned by a process listening on a
  // wildcard or different-family interface, the old logic returned the busy
  // port. `findAvailablePort` must walk past *every* busy port in sequence,
  // not just the first one.
  it('skips multiple sequentially-busy ports', async () => {
    const { servers, basePort } = await listenConsecutive('127.0.0.1', 2)
    try {
      const result = await findAvailablePort('127.0.0.1', basePort, basePort + SEARCH_SPAN)
      expect(result).toBeGreaterThanOrEqual(basePort + 2)
    } finally {
      await closeServers(servers)
    }
  })

  // Wildcard `0.0.0.0` listener: the original isPortListening only bound on
  // the requested host (127.0.0.1), which on some platforms succeeds even
  // when a peer owns the port via 0.0.0.0. The connect+multi-host bind
  // probe must catch it via the connect leg (the listener is reachable on
  // loopback) regardless of the platform's specific bind semantics.
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
    // Allocate-then-release to find a port that is genuinely free.
    const { server, port } = await listenOn('127.0.0.1')
    await closeServer(server)
    expect(await isPortListening(port, '127.0.0.1')).toBe(false)
  })
})

// A server that accepts TCP connections but never sends an HTTP response,
// so the poller's request stays in flight until aborted or timed out.
// Tracks its sockets so close() can settle without waiting on them.
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
      // The in-flight request never ends on its own, and no later poll pass can run: only the
      // abort listener can settle this. Without it, the test times out instead of passing slowly,
      // so no wall-clock bound is needed.
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
      // As for waitForPort: only the abort listener can settle this.
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
      // A deadline on the frozen wall clock would never pass: this would hang past the test's
      // own timeout instead of returning.
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
  // A detached parent with a child of its own: the shape Desktop spawns ComfyUI in.
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
      // The log names what the group stop covered.
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
  // The abort tests rely on it: a probe that ignored the option would end at the 2 s default and
  // let a later poll pass settle the wait, which is what those tests must rule out.
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
      wait.catch(() => {}) // settled by the abort, in the test or in cleanup
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
      // Even when an assertion threw first: a live waiter would keep polling for minutes.
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
      wait.catch(() => {}) // settled by the abort, in the test or in cleanup
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
      // Even when an assertion threw first: a live waiter would keep polling for minutes.
      controller.abort()
      get.mockRestore()
      await close()
    }
  })
})

describe('a spent budget still ends the wait', () => {
  // With nothing left of timeoutMs the probe's timeout must not become 0, which Node reads as
  // "no timeout": the probe would hang on a silent peer and the wait would never time out.
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

describe('setPortArg', () => {
  it.each([
    [['-s', 'main.py', '--port', '8188']],
    [['-s', 'main.py', '--port', '8188', '--port', '9000']],
    [['-s', 'main.py', '--port=8188', '--port', '9000']],
    [['-s', 'main.py', '--port', '9000', '--port=8188']],
    [['-s', 'main.py']]
  ])('leaves %j with exactly one --port, the new one', (args) => {
    const launchCmd = { args: [...args], port: 0 }
    setPortArg(launchCmd, 9001)
    expect(launchCmd.args).toEqual(['-s', 'main.py', '--port', '9001'])
    expect(launchCmd.port).toBe(9001)
  })
})
