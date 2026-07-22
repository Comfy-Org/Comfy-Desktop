import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Options for {@link startLoopbackListener}. */
export interface LoopbackListenerOptions {
  /** The exact `state` value generated for this authorization request. */
  expectedState: string
  /** How long to wait for the browser callback before giving up, in milliseconds. */
  timeoutMs: number
}

/** Handle returned once the loopback listener is bound and ready. */
export interface LoopbackListener {
  /** The `http://127.0.0.1:<port>/callback` URI to register as the OAuth redirect target. */
  redirectUri: string
  /**
   * Resolves with the authorization `code` once the browser hits the callback
   * with a matching `state`. Rejects on `state` mismatch, an IdP `error`, or
   * timeout. Returns the same promise on every call.
   */
  waitForCode: () => Promise<{ code: string }>
}

function renderHtml(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ComfyUI</title></head><body><p>${message}</p></body></html>`
}

/**
 * Start a single-shot loopback HTTP listener that serves as the redirect target
 * for a PKCE OAuth flow (RFC 8252 §7.3). It binds `127.0.0.1` on an OS-assigned
 * ephemeral port, waits for exactly one `GET /callback`, validates `state`, and
 * shuts down — the server never survives past the first callback.
 */
export function startLoopbackListener(
  options: LoopbackListenerOptions,
): Promise<LoopbackListener> {
  const { expectedState, timeoutMs } = options

  return new Promise((resolveListener, rejectListener) => {
    let settled = false
    let resolveCode!: (result: { code: string }) => void
    let rejectCode!: (err: Error) => void
    const codePromise = new Promise<{ code: string }>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })
    // Keep the promise "handled" so a timeout/error that fires before the caller
    // invokes waitForCode() never surfaces as an unhandled rejection. Real
    // callers still observe the rejection through their own await on this promise.
    void codePromise.catch(() => {})

    let server: Server | null = null

    const close = (): void => {
      clearTimeout(timeoutHandle)
      if (server) {
        // Graceful close: stops accepting new connections immediately (so a
        // second callback to the same URL is refused) while letting the
        // in-flight response finish. Every response sets `Connection: close`,
        // so sockets drain and the listener fully shuts down afterwards.
        try {
          server.close()
        } catch {
          // best-effort shutdown
        }
        server = null
      }
    }

    const finishWithError = (err: Error): void => {
      if (settled) return
      settled = true
      close()
      rejectCode(err)
    }

    const finishWithSuccess = (code: string): void => {
      if (settled) return
      settled = true
      close()
      resolveCode({ code })
    }

    /** Answer the browser with a failure page and settle the code wait. */
    const failRequest = (res: ServerResponse, statusCode: number, err: Error): void => {
      res.statusCode = statusCode
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(renderHtml('Sign-in failed. You can close this window.'))
      finishWithError(err)
    }

    const timeoutHandle = setTimeout(() => {
      finishWithError(new Error('Loopback OAuth callback timed out'))
    }, timeoutMs)

    function handleRequest(req: IncomingMessage, res: ServerResponse): void {
      // Defence-in-depth: we only bind 127.0.0.1, so every peer is already a
      // loopback address, but reject anything else outright just in case.
      const remoteHost = req.socket.remoteAddress ?? ''
      const isLoopback =
        remoteHost === '127.0.0.1' ||
        remoteHost === '::1' ||
        remoteHost === '::ffff:127.0.0.1'
      if (!isLoopback) {
        res.statusCode = 403
        res.end()
        return
      }

      const url = req.url ?? '/'
      const queryStart = url.indexOf('?')
      const path = queryStart >= 0 ? url.slice(0, queryStart) : url
      const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart + 1) : '')

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

      // CSRF protection: the callback must echo back the exact state we issued.
      if (params.get('state') !== expectedState) {
        failRequest(res, 400, new Error('state mismatch'))
        return
      }

      // The IdP reported a failure (e.g. the user denied consent). 200 — the
      // browser reached us fine; the failure is the flow's, not the request's.
      const callbackError = params.get('error')
      if (callbackError) {
        failRequest(res, 200, new Error(callbackError))
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
      res.end(renderHtml('You can close this window.'))
      finishWithSuccess(code)
    }

    server = createServer((req, res) => {
      // Single-shot listener: never keep sockets alive across the one callback.
      res.setHeader('Connection', 'close')
      handleRequest(req, res)
    })

    server.on('error', (err: Error) => {
      // A bind failure (or similar) before the handle resolved: fail both the
      // listener startup and any pending code wait.
      finishWithError(err)
      rejectListener(err)
    })

    // Port 0 => the OS assigns a free ephemeral port; bind loopback only.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo
      resolveListener({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCode: () => codePromise,
      })
    })
  })
}
