import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

export interface RecordedRequest {
  path: string
  host: string | null
  authorization: string | null
  headers: http.IncomingHttpHeaders
}

export class RedirectServer {
  readonly requests: RecordedRequest[] = []
  private readonly server: http.Server
  private readonly sockets = new Set<Socket>()
  private port = 0

  constructor(private readonly body = 'payload') {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://placeholder')
      this.requests.push({
        path: url.pathname,
        host: req.headers.host ?? null,
        authorization: req.headers.authorization ?? null,
        headers: req.headers
      })
      if (url.pathname === '/redirect') {
        const to = url.searchParams.get('to') ?? '/'
        const status = Number(url.searchParams.get('status') ?? '302')
        res.writeHead(status, { Location: to })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': Buffer.byteLength(this.body)
      })
      res.end(this.body)
    })
    this.server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => resolve())
    })
    this.port = (this.server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  base(host: '127.0.0.1' | 'localhost' = '127.0.0.1'): string {
    return `http://${host}:${this.port}`
  }

  redirectUrl(to: string, host: '127.0.0.1' | 'localhost' = '127.0.0.1', status = 302): string {
    return `${this.base(host)}/redirect?status=${status}&to=${encodeURIComponent(to)}`
  }

  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.path === path)
  }

  clear(): void {
    this.requests.length = 0
  }
}
