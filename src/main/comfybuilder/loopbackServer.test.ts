// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { startLoopbackListener } from './loopbackServer'

describe('startLoopbackListener', () => {
  it('resolves with the code on a valid callback, then refuses a second request', async () => {
    const listener = await startLoopbackListener({
      expectedState: 'state-abc',
      timeoutMs: 5_000,
    })
    // Random loopback port, /callback path, 127.0.0.1 (never 0.0.0.0/localhost).
    expect(listener.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)

    const codePromise = listener.waitForCode()
    const res = await fetch(`${listener.redirectUri}?code=auth-code-123&state=state-abc`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('You can close this window')

    await expect(codePromise).resolves.toEqual({ code: 'auth-code-123' })

    // Single-shot: the listener closed after the first callback, so a second
    // request to the same URL cannot connect.
    await expect(
      fetch(`${listener.redirectUri}?code=auth-code-123&state=state-abc`),
    ).rejects.toThrow()
  })

  it('rejects with a "state mismatch" error when the returned state does not match', async () => {
    const listener = await startLoopbackListener({
      expectedState: 'expected-state',
      timeoutMs: 5_000,
    })
    const codePromise = listener.waitForCode()
    // Attach the rejection assertion before triggering the callback so the
    // synchronous reject is never flagged as an unhandled rejection.
    const rejection = expect(codePromise).rejects.toThrow('state mismatch')

    const res = await fetch(`${listener.redirectUri}?code=auth-code-123&state=wrong-state`)
    expect(res.status).toBe(400)

    await rejection
  })
})
