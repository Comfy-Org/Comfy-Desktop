// @vitest-environment node
import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BEACON_ALLOWED_ORIGIN,
  BEACON_PORTS,
  _getBeaconPort,
  buildPingBody,
  handleBeaconRequest,
  startDesktopBeacon,
  stopDesktopBeacon,
} from './desktopBeacon'

const TEST_VERSION = '1.0.20'

/** Fire a real HTTP request against a started beacon. Kept inline so tests
 *  exercise the same path the cloud frontend will. Uses a fresh agent per
 *  call so the global keep-alive pool can't hand us a stale socket from a
 *  previous test's now-dead server (which would surface as ECONNRESET). */
async function fetchPing(
  port: number,
  init?: { origin?: string; method?: string; path?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const agent = new http.Agent({ keepAlive: false })
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: init?.path ?? '/ping',
        method: init?.method ?? 'GET',
        headers: init?.origin ? { Origin: init.origin } : {},
        agent,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          agent.destroy()
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        })
      },
    )
    req.on('error', (err) => {
      agent.destroy()
      reject(err)
    })
    req.end()
  })
}

describe('buildPingBody', () => {
  it('exposes app + version only (no extra fields)', () => {
    const body = JSON.parse(buildPingBody('1.2.3')) as Record<string, unknown>
    expect(body).toEqual({ app: 'comfy-desktop', version: '1.2.3' })
  })
})

describe('handleBeaconRequest (unit)', () => {
  function makeRes() {
    let writtenStatus = 0
    let writtenHeaders: Record<string, string | number> = {}
    let body = ''
    const inner = {
      headersSent: false,
      writeHead(status: number, headers?: http.OutgoingHttpHeaders): void {
        writtenStatus = status
        writtenHeaders = (headers ?? {}) as Record<string, string | number>
        inner.headersSent = true
      },
      end(payload?: string): void {
        if (payload) body += payload
      },
    }
    const res = inner as unknown as http.ServerResponse
    return {
      res,
      get status() {
        return writtenStatus
      },
      get headers() {
        return writtenHeaders
      },
      get body() {
        return body
      },
    }
  }

  it('GET /ping with allowed Origin returns 200 + CORS header + JSON body', () => {
    const t = makeRes()
    handleBeaconRequest(
      {
        method: 'GET',
        url: '/ping',
        headers: { origin: BEACON_ALLOWED_ORIGIN },
      } as unknown as http.IncomingMessage,
      t.res,
      TEST_VERSION,
    )
    expect(t.status).toBe(200)
    expect(t.headers['Access-Control-Allow-Origin']).toBe(BEACON_ALLOWED_ORIGIN)
    expect(t.headers['Vary']).toBe('Origin')
    expect(JSON.parse(t.body)).toEqual({ app: 'comfy-desktop', version: TEST_VERSION })
  })

  it('GET /ping without an Origin header still returns 200 but omits CORS header', () => {
    const t = makeRes()
    handleBeaconRequest(
      { method: 'GET', url: '/ping', headers: {} } as unknown as http.IncomingMessage,
      t.res,
      TEST_VERSION,
    )
    // No-origin requests come from curl / health checks, not browsers. We
    // still answer (so devs can verify the beacon's alive) but never set
    // CORS, so a cross-origin script that omits the header can't read it.
    expect(t.status).toBe(200)
    expect(t.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('GET /ping with a non-allowed Origin returns 200 but NO CORS header', () => {
    const t = makeRes()
    handleBeaconRequest(
      {
        method: 'GET',
        url: '/ping',
        headers: { origin: 'https://evil.com' },
      } as unknown as http.IncomingMessage,
      t.res,
      TEST_VERSION,
    )
    expect(t.status).toBe(200)
    expect(t.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('returns 404 (and no CORS) for unknown paths', () => {
    const t = makeRes()
    handleBeaconRequest(
      {
        method: 'GET',
        url: '/admin',
        headers: { origin: BEACON_ALLOWED_ORIGIN },
      } as unknown as http.IncomingMessage,
      t.res,
      TEST_VERSION,
    )
    expect(t.status).toBe(404)
    expect(t.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('returns 404 (and no CORS) for non-GET methods on /ping', () => {
    const t = makeRes()
    handleBeaconRequest(
      {
        method: 'POST',
        url: '/ping',
        headers: { origin: BEACON_ALLOWED_ORIGIN },
      } as unknown as http.IncomingMessage,
      t.res,
      TEST_VERSION,
    )
    expect(t.status).toBe(404)
    expect(t.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('answers OPTIONS preflight for the allowed origin', () => {
    const t = makeRes()
    handleBeaconRequest(
      {
        method: 'OPTIONS',
        url: '/ping',
        headers: { origin: BEACON_ALLOWED_ORIGIN },
      } as unknown as http.IncomingMessage,
      t.res,
      TEST_VERSION,
    )
    expect(t.status).toBe(204)
    expect(t.headers['Access-Control-Allow-Origin']).toBe(BEACON_ALLOWED_ORIGIN)
    expect(t.headers['Access-Control-Allow-Methods']).toBe('GET')
  })

  it('rejects OPTIONS preflight for a disallowed origin', () => {
    const t = makeRes()
    handleBeaconRequest(
      {
        method: 'OPTIONS',
        url: '/ping',
        headers: { origin: 'https://evil.com' },
      } as unknown as http.IncomingMessage,
      t.res,
      TEST_VERSION,
    )
    expect(t.status).toBe(404)
    expect(t.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('startDesktopBeacon (integration)', () => {
  afterEach(async () => {
    await stopDesktopBeacon()
  })

  it('binds to 127.0.0.1 on a port in the allowlist and responds to /ping', async () => {
    const port = await startDesktopBeacon(TEST_VERSION)
    expect(port).not.toBeNull()
    expect(BEACON_PORTS).toContain(port!)
    expect(_getBeaconPort()).toBe(port)

    const res = await fetchPing(port!, { origin: BEACON_ALLOWED_ORIGIN })
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(BEACON_ALLOWED_ORIGIN)
    expect(JSON.parse(res.body)).toEqual({ app: 'comfy-desktop', version: TEST_VERSION })
  })

  it('is idempotent — calling start twice returns the same port without rebinding', async () => {
    const first = await startDesktopBeacon(TEST_VERSION)
    const second = await startDesktopBeacon(TEST_VERSION)
    expect(first).toBe(second)
  })

  it('falls through to a later port when the first allowlisted port is taken', async () => {
    // Pre-occupy the first port to force the fallthrough path.
    const squatter = http.createServer()
    await new Promise<void>((resolve, reject) => {
      squatter.once('error', reject)
      squatter.listen(BEACON_PORTS[0], '127.0.0.1', () => resolve())
    })
    try {
      const port = await startDesktopBeacon(TEST_VERSION)
      expect(port).not.toBeNull()
      expect(port).not.toBe(BEACON_PORTS[0])
      expect(BEACON_PORTS.slice(1)).toContain(port!)
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()))
    }
  })

  it('returns null and stays disabled when every allowed port is taken', async () => {
    const squatters: http.Server[] = []
    for (const p of BEACON_PORTS) {
      const s = http.createServer()
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject)
        s.listen(p, '127.0.0.1', () => resolve())
      })
      squatters.push(s)
    }
    try {
      const port = await startDesktopBeacon(TEST_VERSION)
      expect(port).toBeNull()
      expect(_getBeaconPort()).toBeNull()
    } finally {
      for (const s of squatters) {
        await new Promise<void>((resolve) => s.close(() => resolve()))
      }
    }
  })

  it('a non-allowed Origin gets the body but no CORS header (so the browser blocks the read)', async () => {
    const port = await startDesktopBeacon(TEST_VERSION)
    const res = await fetchPing(port!, { origin: 'https://evil.com' })
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('unknown paths 404 without leaking CORS headers', async () => {
    const port = await startDesktopBeacon(TEST_VERSION)
    const res = await fetchPing(port!, { origin: BEACON_ALLOWED_ORIGIN, path: '/admin' })
    expect(res.status).toBe(404)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('refuses non-GET methods on /ping (locks down probing)', async () => {
    const port = await startDesktopBeacon(TEST_VERSION)
    const res = await fetchPing(port!, { origin: BEACON_ALLOWED_ORIGIN, method: 'POST' })
    expect(res.status).toBe(404)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('stopDesktopBeacon', () => {
  beforeEach(async () => {
    await stopDesktopBeacon()
  })

  it('is a safe no-op when the beacon was never started', async () => {
    await expect(stopDesktopBeacon()).resolves.toBeUndefined()
  })

  it('closes the server and clears state so a subsequent start re-binds', async () => {
    const port = await startDesktopBeacon(TEST_VERSION)
    expect(port).not.toBeNull()
    await stopDesktopBeacon()
    expect(_getBeaconPort()).toBeNull()
    const port2 = await startDesktopBeacon(TEST_VERSION)
    expect(port2).not.toBeNull()
    await stopDesktopBeacon()
  })
})
