/**
 * Tiny localhost HTTP server that lets `cloud.comfy.org` discover whether
 * Comfy Desktop is currently running on this machine. The cloud web app
 * pings `/ping`; a successful response is the signal it uses to (a) decide
 * whether to forward share links into the app via `comfy://`, and (b) cache
 * a "Desktop has been seen" hint in `localStorage` so subsequent visits can
 * still hand off even when Desktop is closed.
 *
 * Design rules:
 *   - Bind to 127.0.0.1 only — never `0.0.0.0` or a hostname. A wrong bind
 *     would expose the endpoint to anyone on the local network.
 *   - CORS strictly locked to `https://cloud.comfy.org`. No `*`, no wildcard
 *     subdomains. Other origins receive no `Access-Control-Allow-Origin`
 *     header, so they cannot read the response body.
 *   - Single endpoint, single method: `GET /ping`. Everything else returns
 *     404 with no CORS headers — cross-origin scripts can't probe shape.
 *   - Three-port allowlist with first-free-wins. If all three are taken
 *     we silently disable detection that session rather than scanning a
 *     wider range (which would slow startup and look like nmap traffic).
 *
 * What the response reveals: `{ app: 'comfy-desktop', version: '<x.y.z>' }`.
 * Intentional — that's exactly the bit the frontend needs and nothing more.
 * Same info the About box happily prints.
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** CORS allowlist. Production traffic only ever comes from cloud.comfy.org
 *  (and the test domain we deploy to before promoting). Local dev origins
 *  are included so ComfyUI_frontend developers running `pnpm dev:cloud`
 *  against a packaged Desktop install can verify the discovery flow
 *  end-to-end. Anything not in this set gets no `Access-Control-Allow-Origin`
 *  header and the browser blocks the read. */
export const BEACON_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://cloud.comfy.org',
  'https://testcloud.comfy.org',
  'http://localhost:5173',
  'http://localhost:5174',
])

/** Back-compat: the production origin tests and other call sites have used. */
export const BEACON_ALLOWED_ORIGIN = 'https://cloud.comfy.org'

/** Three-port allowlist. Chosen in the 51000-52000 range, outside common app
 *  ports and outside the ephemeral range Windows reserves. If a future
 *  Desktop release needs to move ports, keep the previous entry alongside
 *  for a transition window so old frontend builds keep working. */
export const BEACON_PORTS: readonly number[] = [51823, 51824, 51825]

interface BeaconState {
  server: http.Server
  port: number
}

let _state: BeaconState | null = null

/** Build the `/ping` response body. Factored out so tests can lock the
 *  shape down — the frontend depends on `app === 'comfy-desktop'` to
 *  distinguish us from any other localhost service on the same port. */
export function buildPingBody(version: string): string {
  return JSON.stringify({ app: 'comfy-desktop', version })
}

/** Single request handler. Pure-ish (no IO outside the response object) so
 *  it's exercised directly by unit tests without bind/listen. */
export function handleBeaconRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  version: string,
): void {
  const origin = req.headers['origin']
  const isAllowedOrigin = typeof origin === 'string' && BEACON_ALLOWED_ORIGINS.has(origin)

  // Explicit `Content-Length: 0` on empty responses is required: without it
  // Node falls back to chunked / connection-close framing and Windows TCP
  // can RST the socket before the client reads the status, surfacing as
  // ECONNRESET on the frontend instead of a clean 404.
  const empty = (status: number, extraHeaders?: http.OutgoingHttpHeaders): void => {
    res.writeHead(status, { 'Content-Length': '0', ...extraHeaders })
    res.end()
  }

  // Preflight: the frontend uses a simple GET with no custom headers, so a
  // CORS preflight only fires when the browser thinks it needs one. Answer
  // it for the allowed origin; reject everything else with a bare 404.
  if (req.method === 'OPTIONS') {
    if (isAllowedOrigin && req.url === '/ping') {
      empty(204, {
        'Access-Control-Allow-Origin': origin as string,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      return
    }
    empty(404)
    return
  }

  if (req.method !== 'GET' || req.url !== '/ping') {
    empty(404)
    return
  }

  const body = buildPingBody(version)
  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body).toString(),
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
  if (isAllowedOrigin) {
    headers['Access-Control-Allow-Origin'] = origin as string
  }
  res.writeHead(200, headers)
  res.end(body)
}

/** Try the port allowlist in order. Resolves to the bound port number, or
 *  `null` if every port is taken (in which case the beacon silently disables
 *  for this session). Loopback-only — `host = '127.0.0.1'` is non-negotiable. */
async function bindFirstFreePort(
  server: http.Server,
  ports: readonly number[],
): Promise<number | null> {
  for (const port of ports) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('error', onError)
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          resolve(false)
          return
        }
        // Unexpected error — log and skip this port.
        console.warn('[beacon] unexpected bind error', { port, code: err.code })
        resolve(false)
      }
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError)
        const addr = server.address() as AddressInfo | null
        resolve(addr !== null && addr.port === port)
      })
    })
    if (ok) return port
  }
  return null
}

/** Start the beacon. Idempotent — repeated calls return without re-binding.
 *  No-op when every allowed port is taken; callers see that as "detection
 *  silently disabled" rather than a hard error. */
export async function startDesktopBeacon(version: string): Promise<number | null> {
  if (_state !== null) return _state.port

  const server = http.createServer((req, res) => {
    try {
      handleBeaconRequest(req, res, version)
    } catch (err) {
      // The handler is small and synchronous, but harden against a future
      // refactor regressing it into something throw-prone.
      console.warn('[beacon] request handler threw', err)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })

  // Errors after a successful bind (e.g. EMFILE under file-descriptor
  // pressure) shouldn't crash the main process. Log and continue.
  server.on('error', (err) => {
    console.warn('[beacon] runtime server error', err)
  })

  const port = await bindFirstFreePort(server, BEACON_PORTS)
  if (port === null) {
    return null
  }
  _state = { server, port }
  return port
}

/** Stop the beacon. Safe to call when never started — used as an
 *  unconditional teardown in `before-quit`. */
export async function stopDesktopBeacon(): Promise<void> {
  const state = _state
  if (state === null) return
  _state = null
  await new Promise<void>((resolve) => {
    state.server.close(() => resolve())
  })
}

/** Test-only: bound port for assertions. Returns `null` when not running. */
export function _getBeaconPort(): number | null {
  return _state?.port ?? null
}
