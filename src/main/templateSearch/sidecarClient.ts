import http from 'http'
import type { SidecarReady } from './sidecar'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export class SidecarRequestError extends Error {
  constructor(
    message: string,
    readonly unreachable: boolean
  ) {
    super(message)
  }
}

export function postToSidecar(
  ready: SidecarReady,
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<unknown> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: ready.port,
        path,
        method: 'POST',
        agent: false,
        headers: {
          authorization: `Bearer ${ready.token}`,
          'content-type': 'application/json',
          'content-length': payload.length
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('the answer is too large'))
          else chunks.push(chunk)
        })
        response.on('close', () => {
          if (!response.complete)
            reject(new SidecarRequestError('the search stopped mid-answer', true))
        })
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new SidecarRequestError(`the search answered ${response.statusCode}`, false))
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new SidecarRequestError('the search sent an answer that is not JSON', false))
          }
        })
      }
    )
    request.setTimeout(timeoutMs, () => request.destroy(new Error('the search timed out')))
    request.on('error', (err: NodeJS.ErrnoException) =>
      reject(
        new SidecarRequestError(
          err.message,
          err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET'
        )
      )
    )
    request.end(payload)
  })
}
