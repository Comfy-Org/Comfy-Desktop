// @vitest-environment node
import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { startLoopbackListener, type LoopbackListener } from './loopback'

function get(url: string): Promise<{ status: number; body: string; contentType?: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => {
          const contentType = res.headers['content-type']
          resolve({
            status: res.statusCode ?? 0,
            body,
            ...(typeof contentType === 'string' ? { contentType } : {})
          })
        })
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
    const response = await get(`${listener.redirectUri}?state=st&code=the-code`)
    expect(response).toMatchObject({ status: 200, contentType: 'text/html; charset=utf-8' })
    expect(response.body).toContain('Authorization complete')
    expect(response.body).toContain('You can close this window and return to Comfy Desktop.')
    expect(response.body).toContain('This page is served locally by Comfy Desktop.')
    expect(response.body).toContain('<style>')
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

    const invalidResponse = await get(`${listener.redirectUri}?state=WRONG&code=x`)
    expect(invalidResponse.status).toBe(400)
    expect(invalidResponse.body).toContain('Invalid sign-in response')
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
    const response = await get(`${listener.redirectUri}?state=st&error=access_denied`)
    expect(response.status).toBe(200)
    expect(response.body).toContain('Sign-in unsuccessful')
    expect(response.body).toContain('try signing in again')
    await expect(codeP).rejects.toThrow(/access_denied/)
  })
})
