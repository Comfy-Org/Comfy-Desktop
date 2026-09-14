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

function html(kind: 'success' | 'error' | 'invalid'): string {
  const success = kind === 'success'
  const title = success
    ? 'Authorization complete'
    : kind === 'invalid'
      ? 'Invalid sign-in response'
      : 'Sign-in unsuccessful'
  const message = success
    ? 'You can close this window and return to Comfy Desktop.'
    : kind === 'invalid'
      ? 'This sign-in response was not recognized. Return to Comfy Desktop and try again.'
      : 'Return to Comfy Desktop and try signing in again. You can close this window.'
  const icon = success ? '<path d="M20 6 9 17l-5-5" />' : '<path d="M12 8v5m0 3h.01" />'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>${title} | Comfy Desktop</title>
    <style>
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        color: #f5f3ff;
        background:
          radial-gradient(circle at 50% 0%, #332657 0, transparent 48%),
          #101014;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(100%, 440px);
        padding: 40px;
        text-align: center;
        background: rgba(29, 28, 37, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        box-shadow: 0 24px 72px rgba(0, 0, 0, 0.38);
      }
      .brand {
        margin: 0 0 24px;
        color: #b8a7e8;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .icon {
        width: 56px;
        height: 56px;
        margin: 0 auto 22px;
        display: grid;
        place-items: center;
        color: ${success ? '#c4b5fd' : '#fca5a5'};
        background: ${success ? 'rgba(124, 58, 237, 0.2)' : 'rgba(239, 68, 68, 0.16)'};
        border: 1px solid ${success ? 'rgba(196, 181, 253, 0.34)' : 'rgba(252, 165, 165, 0.3)'};
        border-radius: 16px;
      }
      .icon svg {
        width: 28px;
        height: 28px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      h1 {
        margin: 0;
        font-size: 26px;
        line-height: 1.2;
        letter-spacing: -0.02em;
      }
      .message {
        margin: 14px auto 0;
        color: #c5c2d0;
        font-size: 15px;
        line-height: 1.6;
      }
      .local-note {
        margin: 28px 0 0;
        padding-top: 20px;
        color: #817d8d;
        font-size: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      @media (max-width: 480px) {
        main { padding: 32px 24px; }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="brand">Comfy Desktop</p>
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">${icon}</svg>
      </div>
      <h1>${title}</h1>
      <p class="message">${message}</p>
      <p class="local-note">This page is served locally by Comfy Desktop.</p>
    </main>
  </body>
</html>`
}

/**
 * Single-shot loopback HTTP listener for a PKCE redirect (RFC 8252 section 7.3): binds
 * `127.0.0.1` on an ephemeral port, waits for exactly one `GET /callback`,
 * validates `state`, and shuts down.
 */
export function startLoopbackListener(options: LoopbackListenerOptions): Promise<LoopbackListener> {
  const { expectedState, timeoutMs } = options
  return new Promise((resolveListener, rejectListener) => {
    let settled = false
    let resolveCode!: (r: { code: string }) => void
    let rejectCode!: (e: Error) => void
    const codePromise = new Promise<{ code: string }>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })
    void codePromise.catch(() => {})

    let server: Server | null = null
    const close = (): void => {
      clearTimeout(timeoutHandle)
      if (server) {
        try {
          server.close()
        } catch {
          /* best-effort */
        }
        server = null
      }
    }
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      close()
      rejectCode(err)
      // If listen() never completed, the caller is still awaiting the outer
      // promise; reject it too so the timeout bounds listener startup as well.
      // A no-op once the listener has already resolved.
      rejectListener(err)
    }
    const succeed = (code: string): void => {
      if (settled) return
      settled = true
      close()
      resolveCode({ code })
    }
    const failRequest = (res: ServerResponse, status: number, err: Error): void => {
      res.statusCode = status
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(html('error'))
      fail(err)
    }
    const timeoutHandle = setTimeout(
      () => fail(new Error('Loopback OAuth callback timed out')),
      timeoutMs
    )

    function handle(req: IncomingMessage, res: ServerResponse): void {
      const remote = req.socket.remoteAddress ?? ''
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        res.statusCode = 403
        res.end()
        return
      }
      const url = req.url ?? '/'
      const q = url.indexOf('?')
      const path = q >= 0 ? url.slice(0, q) : url
      const params = new URLSearchParams(q >= 0 ? url.slice(q + 1) : '')
      if (req.method === 'GET' && path === '/favicon.ico') {
        res.statusCode = 204
        res.end()
        return
      }
      if (req.method !== 'GET' || path !== '/callback') {
        res.statusCode = 404
        res.end()
        return
      }
      // Wrong/missing state = not our callback (a port scan, prefetch, or another
      // flow). Refuse it but KEEP LISTENING so an outsider can't abort our sign-in.
      if (params.get('state') !== expectedState) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(html('invalid'))
        return
      }
      const idpError = params.get('error')
      if (idpError) {
        failRequest(res, 200, new Error(idpError))
        return
      }
      const code = params.get('code')
      if (!code) {
        failRequest(res, 400, new Error('missing authorization code'))
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(html('success'))
      succeed(code)
    }

    server = createServer((req, res) => {
      res.setHeader('Connection', 'close')
      handle(req, res)
    })
    server.on('error', (err: Error) => {
      fail(err)
      rejectListener(err)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo
      resolveListener({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCode: () => codePromise,
        close
      })
    })
  })
}
