// @vitest-environment node
import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { startLoopbackListener, type LoopbackListener } from './loopback'

function get(url: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume()
        resolve({ status: res.statusCode ?? 0 })
      })
      .on('error', reject)
  })
}
/** Drain queued IO callbacks and microtasks so any already-settled promise
 *  has run its handlers; no wall-clock wait. */
const drain = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('loopback listener', () => {
  let listener: LoopbackListener | undefined
  afterEach(() => listener?.close())

  it('resolves the code on a matching-state callback', async () => {
    listener = await startLoopbackListener({ expectedState: 'st', timeoutMs: 5000 })
    const codeP = listener.waitForCode()
    await get(`${listener.redirectUri}?state=st&code=the-code`)
    expect(await codeP).toEqual({ code: 'the-code' })
  })

  it('ignores a wrong-state callback (400) and keeps listening (not aborted)', async () => {
    listener = await startLoopbackListener({ expectedState: 'st', timeoutMs: 5000 })
    const codeP = listener.waitForCode()
    let settled = false
    void codeP.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    expect((await get(`${listener.redirectUri}?state=WRONG&code=x`)).status).toBe(400)
    // Any settlement happens in the same synchronous handler that sends the
    // response, so once the 400 has arrived a drain is enough for a (wrong)
    // settlement's then-handlers to run.
    await drain()
    expect(settled).toBe(false) // an outsider could not abort our sign-in

    await get(`${listener.redirectUri}?state=st&code=real`)
    expect(await codeP).toEqual({ code: 'real' })
  })

  it('rejects when the IdP reports an error (matching state)', async () => {
    listener = await startLoopbackListener({ expectedState: 'st', timeoutMs: 5000 })
    const codeP = listener.waitForCode()
    await get(`${listener.redirectUri}?state=st&error=access_denied`)
    await expect(codeP).rejects.toThrow(/access_denied/)
  })
})
