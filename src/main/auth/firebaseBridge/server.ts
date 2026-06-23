import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { isAllowedCloudCallbackOrigin } from './origins'

const MAX_BODY_BYTES = 64 * 1024

class BodyTooLargeError extends Error {
  constructor() {
    super('Body too large')
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        settled = true
        reject(new BodyTooLargeError())
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', reject)
  })
}

/** Result handed to the orchestrator once the Firebase exchange succeeds.
 *  `user` is the JSON shape Firebase JS SDK persists in IndexedDB. */
export interface SignInResult {
  user: Record<string, unknown>
  apiKey: string
}

export interface BridgeHandle {
  /** URL to hand to `shell.openExternal` to start the sign-in flow. */
  url: string
  /** Resolves once the IdP callback completes and Firebase mints a user. */
  signInPromise: Promise<SignInResult>
  /** Shut the server down. Safe to call multiple times. */
  close: () => void
}

/**
 * Fixed loopback port for the Cloud login callback. Cloud allowlists this
 * callback target before posting Firebase credentials back to Desktop.
 */
export const BRIDGE_PORT = 9876

export interface StartCloudLoginCallbackServerOpts {
  state: string
  /** Default 5 minutes — long enough for password managers, 2FA, account-picker UI. */
  timeoutMs?: number
  /** Override the loopback port. Defaults to `BRIDGE_PORT` (9876). Tests pass `0` to get a kernel-assigned port. */
  port?: number
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin
  if (!isAllowedCloudCallbackOrigin(origin)) return false
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')
  const privateNetworkRequest = req.headers['access-control-request-private-network']
  const requestedPrivateNetwork =
    privateNetworkRequest === 'true' ||
    (Array.isArray(privateNetworkRequest) && privateNetworkRequest.includes('true'))
  if (req.method === 'OPTIONS' && requestedPrivateNetwork) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  return true
}

/**
 * Start a localhost receiver for the real Cloud login page. Desktop opens
 * cloud.comfy.org in the system browser so PostHog can identify the browser's
 * first-party comfy.org cookie, then Cloud POSTs the Firebase user back here.
 */
export function startCloudLoginCallbackServer(
  opts: StartCloudLoginCallbackServerOpts
): Promise<BridgeHandle> {
  const { state, timeoutMs = 5 * 60_000, port = BRIDGE_PORT } = opts

  return new Promise((resolveHandle, rejectHandle) => {
    let resolved = false
    let signInResolve!: (r: SignInResult) => void
    let signInReject!: (err: Error) => void
    const signInPromise = new Promise<SignInResult>((res, rej) => {
      signInResolve = res
      signInReject = rej
    })

    let server: Server | null = null

    const close = (reason = new Error('Cloud login bridge cancelled before completion')): void => {
      finishWithError(reason)
      if (server) {
        try {
          server.closeAllConnections?.()
          server.close()
        } catch {
          // best-effort shutdown
        }
        server = null
      }
      clearTimeout(timeoutHandle)
    }

    const finishWithError = (err: Error): void => {
      if (!resolved) {
        resolved = true
        signInReject(err)
      }
    }

    const finishWithSuccess = (result: SignInResult): void => {
      if (!resolved) {
        resolved = true
        signInResolve(result)
      }
    }

    const timeoutHandle = setTimeout(() => {
      finishWithError(new Error('Cloud login bridge timed out waiting for sign-in'))
      close()
    }, timeoutMs)

    server = createServer((req, res) => {
      res.setHeader('Connection', 'close')
      void handleRequest(req, res).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (!res.headersSent) {
          res.statusCode = err instanceof BodyTooLargeError ? 413 : 500
          setCorsHeaders(req, res)
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(err instanceof BodyTooLargeError ? 'Payload too large' : 'Login callback failed')
        }
        finishWithError(err instanceof Error ? err : new Error(msg))
      })
    })

    async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const remoteHost = req.socket.remoteAddress ?? ''
      const isLoopback =
        remoteHost === '127.0.0.1' || remoteHost === '::1' || remoteHost === '::ffff:127.0.0.1'
      if (!isLoopback) {
        res.statusCode = 403
        res.end()
        return
      }

      const url = req.url ?? '/'
      const queryStart = url.indexOf('?')
      const path = queryStart >= 0 ? url.slice(0, queryStart) : url

      if (req.method === 'GET' && path === '/favicon.ico') {
        res.statusCode = 204
        res.end()
        return
      }

      if (path !== '/callback') {
        res.statusCode = 404
        res.end()
        return
      }

      if (!setCorsHeaders(req, res)) {
        res.statusCode = 403
        res.end()
        return
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }

      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return
      }

      const body = (await readJsonBody(req)) as {
        state?: unknown
        user?: unknown
        apiKey?: unknown
      }
      if (body.state !== state) {
        res.statusCode = 403
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Invalid state')
        return
      }
      if (!body.user || typeof body.user !== 'object' || typeof body.apiKey !== 'string') {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Missing user payload')
        return
      }

      res.statusCode = 204
      res.end()
      finishWithSuccess({ user: body.user as Record<string, unknown>, apiKey: body.apiKey })
    }

    server.on('error', (err: Error) => {
      finishWithError(err)
      rejectHandle(err)
      close()
    })

    server.listen(port, '127.0.0.1', () => {
      const addr = server!.address() as AddressInfo
      const url = `http://localhost:${addr.port}/`
      resolveHandle({ url, signInPromise, close })
    })
  })
}
