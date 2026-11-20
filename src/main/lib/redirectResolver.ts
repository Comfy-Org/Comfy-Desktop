import { net } from 'electron'
import { isPermittedRedirect, isSameOrigin, type DownloadUrlCheck } from './downloadUrlPolicy'

export interface ResolveRedirectsOptions {
  url: string
  session?: Electron.Session
  headers?: Record<string, string>
  validateUrl: DownloadUrlCheck
  validateHop?: DownloadUrlCheck
  maxRedirects?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export type ResolveRedirectsResult =
  { ok: true; url: string; sendCredentials: boolean } | { ok: false; error: string }

const DEFAULT_MAX_REDIRECTS = 10
const DEFAULT_TIMEOUT_MS = 30_000

type Hop =
  { kind: 'redirect'; location: string } | { kind: 'final' } | { kind: 'error'; error: string }

function probe(
  url: string,
  session: Electron.Session | undefined,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<Hop> {
  return new Promise((resolve) => {
    let settled = false
    let request: Electron.ClientRequest
    const finish = (hop: Hop): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try {
        request.abort()
      } catch {}
      resolve(hop)
    }
    const onAbort = (): void => finish({ kind: 'error', error: 'Download cancelled' })
    const timer = setTimeout(
      () => finish({ kind: 'error', error: 'Download failed: timed out resolving redirects' }),
      timeoutMs
    )
    try {
      request = net.request({
        url,
        ...(session ? { session, useSessionCookies: true } : {}),
        redirect: 'manual'
      })
      request.setHeader('User-Agent', 'ComfyUI-Desktop-2')
      for (const [name, value] of Object.entries(headers ?? {})) request.setHeader(name, value)
    } catch (err) {
      clearTimeout(timer)
      resolve({ kind: 'error', error: `Download failed: ${(err as Error).message}` })
      return
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    request.on('redirect', (_status, _method, location) => finish({ kind: 'redirect', location }))
    request.on('response', () => finish({ kind: 'final' }))
    request.on('error', (err) =>
      finish({ kind: 'error', error: `Download failed: ${err.message}` })
    )
    request.end()
  })
}

export async function resolveRedirects(
  opts: ResolveRedirectsOptions
): Promise<ResolveRedirectsResult> {
  const {
    session,
    headers,
    validateUrl,
    validateHop = validateUrl,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal
  } = opts
  let current = opts.url
  if (!validateUrl(current)) {
    return { ok: false, error: 'Download failed: the download URL is not allowed' }
  }
  let sendCredentials = true
  for (let hops = 0; ; hops++) {
    sendCredentials &&= isSameOrigin(current, opts.url)
    const hop = await probe(
      current,
      session,
      sendCredentials ? headers : undefined,
      timeoutMs,
      signal
    )
    if (hop.kind === 'final') return { ok: true, url: current, sendCredentials }
    if (hop.kind === 'error') return { ok: false, error: hop.error }
    if (hops >= maxRedirects) return { ok: false, error: 'Download failed: too many redirects' }
    let next: string
    try {
      next = new URL(hop.location, current).toString()
    } catch {
      return { ok: false, error: 'Download failed: invalid redirect location' }
    }
    if (!isPermittedRedirect(current, next, validateHop)) {
      return { ok: false, error: 'Download failed: redirected to a URL that is not allowed' }
    }
    current = next
  }
}
