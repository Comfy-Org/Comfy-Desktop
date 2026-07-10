import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDesktopLoginCode, DesktopLoginCodeError, exchangeDesktopLoginCode } from './client'

const ORIGIN = 'https://cloud.comfy.org'

const CREATE_REQUEST = {
  platform: 'darwin',
  app_version: '1.0.28',
  code_challenge: 'challenge-value'
}

const EXCHANGE_REQUEST = { code: 'dlc_test-code', code_verifier: 'verifier-value' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

/** fetch stub that stays pending until its abort signal fires. */
function hangingFetch(): typeof fetch {
  return (...args: Parameters<typeof fetch>) =>
    new Promise<Response>((_resolve, reject) => {
      args[1]?.signal?.addEventListener('abort', () =>
        reject(new DOMException('This operation was aborted', 'AbortError'))
      )
    })
}

/** fetch stub that resolves headers but leaves the response body open. */
function stalledBodyFetch(): typeof fetch {
  return (...args: Parameters<typeof fetch>) => {
    const signal = args[1]?.signal
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'))
        signal?.addEventListener(
          'abort',
          () => controller.error(new DOMException('This operation was aborted', 'AbortError')),
          { once: true }
        )
      }
    })
    return Promise.resolve(new Response(body, { status: 200 }))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createDesktopLoginCode', () => {
  it('POSTs the request and parses a 201 grant', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(201, {
        code: 'dlc_abc',
        expires_in: 300,
        poll_interval: 3,
        exchange_window: 120
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const grant = await createDesktopLoginCode(ORIGIN, CREATE_REQUEST)

    expect(grant).toEqual({
      code: 'dlc_abc',
      expires_in: 300,
      poll_interval: 3,
      exchange_window: 120
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/auth/desktop-login-codes`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(CREATE_REQUEST)
  })

  it('treats a create 404 as terminal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: 'not found' }))
    )

    const err = await createDesktopLoginCode(ORIGIN, CREATE_REQUEST).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    const typed = err as DesktopLoginCodeError
    expect(typed.status).toBe(404)
    expect(typed.retryable).toBe(false)
  })

  it('rejects an unexpected 201 payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(201, { code: 'dlc_abc' }))
    )

    await expect(createDesktopLoginCode(ORIGIN, CREATE_REQUEST)).rejects.toThrow(
      DesktopLoginCodeError
    )
  })

  it('rejects a grant with a non-positive poll_interval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(201, {
          code: 'dlc_abc',
          expires_in: 300,
          poll_interval: 0,
          exchange_window: 120
        })
      )
    )

    await expect(createDesktopLoginCode(ORIGIN, CREATE_REQUEST)).rejects.toThrow(
      DesktopLoginCodeError
    )
  })

  it('rejects a grant with a non-positive expires_in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(201, {
          code: 'dlc_abc',
          expires_in: -1,
          poll_interval: 3,
          exchange_window: 120
        })
      )
    )

    await expect(createDesktopLoginCode(ORIGIN, CREATE_REQUEST)).rejects.toThrow(
      DesktopLoginCodeError
    )
  })

  it('rejects a grant with a non-positive exchange_window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(201, {
          code: 'dlc_abc',
          expires_in: 300,
          poll_interval: 3,
          exchange_window: 0
        })
      )
    )

    await expect(createDesktopLoginCode(ORIGIN, CREATE_REQUEST)).rejects.toThrow(
      DesktopLoginCodeError
    )
  })

  it('classifies a timeout as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch()))

    const err = await createDesktopLoginCode(ORIGIN, CREATE_REQUEST, { timeoutMs: 5 }).catch(
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    expect((err as DesktopLoginCodeError).retryable).toBe(true)
  })

  it('keeps the timeout active until the response body finishes', async () => {
    vi.stubGlobal('fetch', vi.fn(stalledBodyFetch()))

    const err = await createDesktopLoginCode(ORIGIN, CREATE_REQUEST, { timeoutMs: 5 }).catch(
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    expect((err as DesktopLoginCodeError).message).toMatch(/timed out/)
  })
})

describe('exchangeDesktopLoginCode', () => {
  it('parses a pending response', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(200, { status: 'pending' })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST)).resolves.toEqual({
      status: 'pending'
    })
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/auth/desktop-login-codes/exchange`)
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual(EXCHANGE_REQUEST)
  })

  it('parses a complete response with the custom token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { status: 'complete', custom_token: 'token-value' }))
    )

    await expect(exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST)).resolves.toEqual({
      status: 'complete',
      custom_token: 'token-value'
    })
  })

  it('treats 403 as terminal and never echoes the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { error: 'forbidden' }))
    )

    const err = await exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    const typed = err as DesktopLoginCodeError
    expect(typed.status).toBe(403)
    expect(typed.retryable).toBe(false)
    expect(typed.message).not.toContain(EXCHANGE_REQUEST.code)
    expect(typed.message).not.toContain(EXCHANGE_REQUEST.code_verifier)
  })

  it('treats 404 as terminal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: 'not found' }))
    )

    const err = await exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    expect((err as DesktopLoginCodeError).retryable).toBe(false)
  })

  it('treats 500 as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: 'oops' }))
    )

    const err = await exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    const typed = err as DesktopLoginCodeError
    expect(typed.status).toBe(500)
    expect(typed.retryable).toBe(true)
  })

  it('treats an unexpected 200 payload as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { status: 'wat' }))
    )

    const err = await exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    expect((err as DesktopLoginCodeError).retryable).toBe(true)
  })

  it('treats a network failure as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    const err = await exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DesktopLoginCodeError)
    expect((err as DesktopLoginCodeError).retryable).toBe(true)
  })

  it('propagates a caller abort untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch()))
    const controller = new AbortController()

    const pending = exchangeDesktopLoginCode(ORIGIN, EXCHANGE_REQUEST, {
      signal: controller.signal
    })
    controller.abort()

    const err = await pending.catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(DesktopLoginCodeError)
    expect((err as Error).name).toBe('AbortError')
  })
})
