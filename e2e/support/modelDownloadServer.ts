/**
 * Real local HTTP server for lifecycle model-download tests. No mocks: the
 * app's managed transport (`net.request`) talks to this over a loopback
 * socket exactly as it would to a model host.
 *
 * Per-file behavior is configurable so a spec can exercise the full transfer
 * lifecycle deterministically:
 *   - throttled chunked bodies (so Pause/Cancel can land mid-flight),
 *   - forced mid-body socket destruction (network interruption),
 *   - RFC 9110 Range / If-Range resume with strong ETag + Last-Modified.
 *
 * Every request is logged (path, Range, If-Range) so tests can assert the
 * transport resumed from the exact staged byte offset.
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'node:net'

export interface ServedModel {
  bytes: Buffer
  /** Strong ETag (sent verbatim, matched verbatim against If-Range). */
  etag: string
  lastModified: string
  /** Body streaming granularity. Default: 256 KiB. */
  chunkSize?: number
  /** Delay between chunks. Default: 0 (as fast as the socket drains). */
  chunkDelayMs?: number
  /** Destroy the socket after sending this many body bytes of the current
   *  response (simulated network interruption). Cleared via configure(). */
  failAfterBytes?: number
}

export interface LoggedRequest {
  path: string
  range: string | null
  ifRange: string | null
  status: number
}

/** Deterministic pseudo-random content so completed files can be verified
 *  byte-for-byte and resumed splices are provably contiguous. */
export function deterministicBytes(size: number, seed: number): Buffer {
  const buf = Buffer.allocUnsafe(size)
  for (let i = 0; i < size; i++) {
    buf[i] = (i * 31 + seed * 17 + (i >> 8) * 7) & 0xff
  }
  return buf
}

export class ModelDownloadServer {
  private readonly server: http.Server
  private readonly models = new Map<string, ServedModel>()
  private readonly sockets = new Set<Socket>()
  readonly requests: LoggedRequest[] = []
  private port = 0

  constructor() {
    this.server = http.createServer((req, res) => this.handle(req, res))
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

  setModel(name: string, model: ServedModel): void {
    this.models.set(name, model)
  }

  /** Adjust a served file's behavior mid-test (e.g. clear failAfterBytes). */
  configure(name: string, patch: Partial<ServedModel>): void {
    const model = this.models.get(name)
    if (!model) throw new Error(`unknown model: ${name}`)
    this.models.set(name, { ...model, ...patch })
  }

  urlFor(name: string): string {
    return `http://127.0.0.1:${this.port}/models/${name}`
  }

  /** Logged requests for one served file, oldest first. */
  requestsFor(name: string): LoggedRequest[] {
    return this.requests.filter((r) => r.path === `/models/${name}`)
  }

  clearLog(): void {
    this.requests.length = 0
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const path = (req.url ?? '').split('?')[0]!
    const name = path.startsWith('/models/') ? path.slice('/models/'.length) : ''
    const model = this.models.get(name)
    const rangeHeader = firstHeader(req.headers['range'])
    const ifRangeHeader = firstHeader(req.headers['if-range'])
    if (!model || req.method !== 'GET') {
      this.requests.push({ path, range: rangeHeader, ifRange: ifRangeHeader, status: 404 })
      res.writeHead(404).end()
      return
    }

    const total = model.bytes.length
    let start = 0
    let status = 200
    const rangeMatch = rangeHeader ? /^bytes=(\d+)-$/.exec(rangeHeader) : null
    if (rangeMatch) {
      const from = Number(rangeMatch[1])
      // If-Range: serve the range only when the validator still matches;
      // otherwise fall back to the full body (RFC 9110 semantics). A bare
      // Range without If-Range is honored as long as it is satisfiable.
      const validatorOk =
        !ifRangeHeader || ifRangeHeader === model.etag || ifRangeHeader === model.lastModified
      if (validatorOk && from < total) {
        start = from
        status = 206
      }
    }

    this.requests.push({ path, range: rangeHeader, ifRange: ifRangeHeader, status })

    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      ETag: model.etag,
      'Last-Modified': model.lastModified,
      'Content-Length': total - start
    }
    if (status === 206) {
      headers['Content-Range'] = `bytes ${start}-${total - 1}/${total}`
    }
    res.writeHead(status, headers)

    const chunkSize = model.chunkSize ?? 256 * 1024
    const failAfter = model.failAfterBytes
    let sent = 0
    let cursor = start
    let closed = false
    res.on('close', () => {
      closed = true
    })

    const sendNext = (): void => {
      if (closed) return
      if (failAfter !== undefined && sent >= failAfter) {
        res.socket?.destroy()
        return
      }
      if (cursor >= total) {
        res.end()
        return
      }
      let end = Math.min(cursor + chunkSize, total)
      if (failAfter !== undefined) {
        end = Math.min(end, cursor + (failAfter - sent))
        if (end <= cursor) {
          res.socket?.destroy()
          return
        }
      }
      res.write(model.bytes.subarray(cursor, end), () => {
        sent += end - cursor
        cursor = end
        const delay = model.chunkDelayMs ?? 0
        if (delay > 0) setTimeout(sendNext, delay)
        else setImmediate(sendNext)
      })
    }
    sendNext()
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}
