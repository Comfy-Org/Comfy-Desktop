/**
 * Minimal static ComfyBuilder API for tests. No OAuth, no tokens — the real
 * download path is presigned-URL based, so the mock just points the resolve
 * route at a plain archive route it streams with a Content-Length.
 *
 *   GET /v1/build-artifacts/:id/download  -> { downloadUrl: <baseUrl>/archive.tgz, expiresAt }
 *   GET /archive.tgz                       -> streams `archivePath` (200, Content-Length)
 *
 * Both bind to an ephemeral loopback port (`listen(0)`); `stop()` force-closes
 * keep-alive sockets so a run never hangs on teardown.
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

export interface MockBuilderApi {
  baseUrl: string
  stop(): Promise<void>
}

export interface StartMockBuilderApiOptions {
  /** Archive tarball streamed by the `/archive.tgz` route. Omit for resolve-only tests. */
  archivePath?: string
}

const ARCHIVE_ROUTE = '/archive.tgz'

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        resolve(`http://127.0.0.1:${address.port}`)
      } else {
        reject(new Error('mock builder api did not expose a numeric port'))
      }
    })
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export async function startMockBuilderApi(options: StartMockBuilderApiOptions = {}): Promise<MockBuilderApi> {
  const { archivePath } = options
  let baseUrl = ''

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', baseUrl || 'http://127.0.0.1')
    const segments = url.pathname.split('/').filter(Boolean)

    // GET /v1/build-artifacts/:id/download -> signed URL pointing at the archive route.
    if (
      req.method === 'GET' &&
      segments.length === 4 &&
      segments[0] === 'v1' &&
      segments[1] === 'build-artifacts' &&
      segments[3] === 'download'
    ) {
      sendJson(res, 200, {
        downloadUrl: `${baseUrl}${ARCHIVE_ROUTE}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
      return
    }

    // GET /archive.tgz -> stream the archive with a Content-Length.
    if (req.method === 'GET' && url.pathname === ARCHIVE_ROUTE) {
      if (!archivePath) {
        sendJson(res, 404, { message: 'no archive configured for this mock' })
        return
      }
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(statSync(archivePath).size),
      })
      createReadStream(archivePath).pipe(res)
      return
    }

    sendJson(res, 404, { message: `no route for ${req.method} ${url.pathname}` })
  }

  const server = createServer(handle)
  baseUrl = await listen(server)

  return {
    baseUrl,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
