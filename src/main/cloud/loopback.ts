import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LoopbackListenerOptions {
  /** The exact `state` value generated for this authorization request. */
  expectedState: string
  /** How long to wait for the browser callback before giving up, in ms. */
  timeoutMs: number
}

export interface LoopbackListener {
  /** The `http://127.0.0.1:<port>/callback` URI to register as the redirect target. */
  redirectUri: string
  /** Resolves with the authorization `code` on a matching callback; rejects on
   *  an IdP error (matching state) or timeout. A callback with a wrong/missing
   *  state is ignored (kept listening), never settling. Same promise every call. */
  waitForCode: () => Promise<{ code: string }>
  /** Tear the listener down (idempotent); safe to call after settle. */
  close: () => void
}

function html(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ComfyUI</title></head><body><p>${message}</p></body></html>`
}

/**
 * Single-shot loopback HTTP listener for a PKCE redirect (RFC 8252 §7.3): binds
 * `127.0.0.1` on an ephemeral port, waits for exactly one `GET /callback`,
 * validates `state`, and shuts down.
 */
export function startLoopbackListener(options: LoopbackListenerOptions): Promise<LoopbackListener> {
  const { expectedState, timeoutMs } = options
  return new Promise((resolveListener, rejectListener) => {
    let settled = false
    let resolveCode!: (r: { code: string }) => void
    let rejectCode!: (e: Error) => void
    const codePromise = new Promise<{ code: string }>((res, rej) => { resolveCode = res; rejectCode = rej })
    void codePromise.catch(() => {})

    let server: Server | null = null
    const close = (): void => {
      clearTimeout(timeoutHandle)
      if (server) { try { server.close() } catch { /* best-effort */ } server = null }
    }
    const fail = (err: Error): void => { if (settled) return; settled = true; close(); rejectCode(err) }
    const succeed = (code: string): void => { if (settled) return; settled = true; close(); resolveCode({ code }) }
    const failRequest = (res: ServerResponse, status: number, err: Error): void => {
      res.statusCode = status
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(html('Sign-in failed. You can close this window.'))
      fail(err)
    }
    const timeoutHandle = setTimeout(() => fail(new Error('Loopback OAuth callback timed out')), timeoutMs)

    function handle(req: IncomingMessage, res: ServerResponse): void {
      const remote = req.socket.remoteAddress ?? ''
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        res.statusCode = 403; res.end(); return
      }
      const url = req.url ?? '/'
      const q = url.indexOf('?')
      const path = q >= 0 ? url.slice(0, q) : url
      const params = new URLSearchParams(q >= 0 ? url.slice(q + 1) : '')
      if (req.method === 'GET' && path === '/favicon.ico') { res.statusCode = 204; res.end(); return }
      if (req.method !== 'GET' || path !== '/callback') { res.statusCode = 404; res.end(); return }
      // Wrong/missing state = not our callback (a port scan, prefetch, or another
      // flow). Refuse it but KEEP LISTENING so an outsider can't abort our sign-in.
      if (params.get('state') !== expectedState) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(html('Invalid request.'))
        return
      }
      const idpError = params.get('error')
      if (idpError) { failRequest(res, 200, new Error(idpError)); return }
      const code = params.get('code')
      if (!code) { failRequest(res, 400, new Error('missing authorization code')); return }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(html('You can close this window.'))
      succeed(code)
    }

    server = createServer((req, res) => { res.setHeader('Connection', 'close'); handle(req, res) })
    server.on('error', (err: Error) => { fail(err); rejectListener(err) })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo
      resolveListener({ redirectUri: `http://127.0.0.1:${port}/callback`, waitForCode: () => codePromise, close })
    })
  })
}
