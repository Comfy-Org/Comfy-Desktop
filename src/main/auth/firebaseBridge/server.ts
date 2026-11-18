import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { renderDoneHtml, renderErrorHtml, renderPopupBridgeHtml } from './bridgeHtml'
import { getFirebaseConfig, type FirebaseEnv } from './config'
import type { SupportedProvider } from './intercept'
import { buildPersistedUser, createOauthAuthUri, signInWithIdpExchange } from './oauth'

const MAX_BODY_BYTES = 64 * 1024

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', reject)
  })
}

export interface SignInResult {
  user: Record<string, unknown>
  apiKey: string
}

export interface BridgeHandle {
  url: string
  signInPromise: Promise<SignInResult>
  close: () => void
}

export const BRIDGE_PORT = 9876

export interface StartBridgeOpts {
  env: FirebaseEnv
  providerId: SupportedProvider
  timeoutMs?: number
  port?: number
}

export function startBridgeServer(opts: StartBridgeOpts): Promise<BridgeHandle> {
  const { env, providerId, timeoutMs = 5 * 60_000, port = BRIDGE_PORT } = opts
  const firebaseConfig = getFirebaseConfig(env)

  return new Promise((resolveHandle, rejectHandle) => {
    let resolved = false
    let sessionId: string | null = null
    let signInResolve!: (r: SignInResult) => void
    let signInReject!: (err: Error) => void
    const signInPromise = new Promise<SignInResult>((res, rej) => {
      signInResolve = res
      signInReject = rej
    })

    let server: Server | null = null

    const close = (): void => {
      if (server) {
        try {
          server.closeAllConnections?.()
          server.close()
        } catch {}
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
      finishWithError(new Error('Firebase bridge timed out waiting for sign-in'))
      close()
    }, timeoutMs)

    server = createServer((req, res) => {
      res.setHeader('Connection', 'close')
      void handleRequest(req, res).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(renderErrorHtml(msg))
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
      const search = queryStart >= 0 ? url.slice(queryStart + 1) : ''
      const params = new URLSearchParams(search)

      if (req.method === 'GET' && path === '/favicon.ico') {
        res.statusCode = 204
        res.end()
        return
      }

      if (req.method === 'POST' && path === '/callback') {
        if (providerId !== 'github.com') {
          res.statusCode = 404
          res.end()
          return
        }
        const body = (await readJsonBody(req)) as { user?: Record<string, unknown> }
        if (!body || typeof body !== 'object' || !body.user || typeof body.user !== 'object') {
          res.statusCode = 400
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end('Missing user payload')
          return
        }
        res.statusCode = 204
        res.end()
        finishWithSuccess({ user: body.user, apiKey: firebaseConfig.apiKey })
        return
      }

      if (req.method !== 'GET' || path !== '/') {
        res.statusCode = 404
        res.end()
        return
      }

      const idpError = params.get('error')
      if (idpError) {
        const description =
          params.get('error_description') || params.get('error_message') || idpError
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(renderErrorHtml(description))
        finishWithError(new Error(`IdP error: ${description}`))
        return
      }

      const code = params.get('code')
      const state = params.get('state')

      if (code && state && providerId === 'google.com') {
        if (!sessionId) {
          throw new Error('Callback arrived before initiator')
        }
        const requestUri = `http://localhost:${(server!.address() as AddressInfo).port}${url}`
        const idpResponse = await signInWithIdpExchange(
          firebaseConfig.apiKey,
          providerId,
          requestUri,
          sessionId
        )
        const persistedUser = buildPersistedUser(firebaseConfig, idpResponse, providerId)
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(renderDoneHtml())
        finishWithSuccess({ user: persistedUser, apiKey: firebaseConfig.apiKey })
        return
      }

      if (providerId === 'google.com') {
        const continueUri = `http://localhost:${(server!.address() as AddressInfo).port}/`
        const authResp = await createOauthAuthUri(firebaseConfig.apiKey, providerId, continueUri)
        sessionId = authResp.sessionId
        res.statusCode = 302
        res.setHeader('Location', authResp.authUri)
        res.setHeader('Cache-Control', 'no-store')
        res.end()
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(renderPopupBridgeHtml(firebaseConfig, providerId))
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
