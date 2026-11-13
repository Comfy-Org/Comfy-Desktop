import { afterEach, describe, expect, it, vi } from 'vitest'

import { issueBillingHandoff } from './billingHandoff'

const REQUEST = { workspaceId: 'ws-1', receiver: 'billing_web', clientVersion: '1.2.3' } as const

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('issueBillingHandoff', () => {
  it('refuses when Cloud does not answer within the timeout', async () => {
    const aborted = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted()
              reject(init.signal?.reason)
            })
          })
      )
    )

    await expect(
      issueBillingHandoff('access', REQUEST, { apiBase: 'https://cloud.test/api', timeoutMs: 5 })
    ).resolves.toEqual({ status: 'refused' })
    expect(aborted).toHaveBeenCalledOnce()
  })

  it('posts to the handoff route under the API base, whatever trailing slashes it has', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 'X' }), { status: 400 }))
    )

    await issueBillingHandoff('access', REQUEST, { apiBase: 'https://cloud.test/api//' })

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://cloud.test/api/auth/handoffs',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
