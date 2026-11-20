import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { launchLauncherApp } from './support/electronHarness'
import { evalWithRetry } from './support/evalRetry'
import { RedirectServer } from './support/redirectServer'

type Policy = 'permitted' | 'secure-public'
type ResolveResult =
  { ok: true; url: string; sendCredentials?: boolean } | { ok: false; error: string }
type TransferOutcome =
  | { outcome: 'completed'; savePath: string; finalBytes: number }
  | { outcome: 'paused' }
  | { outcome: 'cancelled' }
  | { outcome: 'error'; error: string }

interface Helpers {
  resolveRedirects(opts: {
    url: string
    policy: Policy
    headers?: Record<string, string>
  }): Promise<ResolveResult>
  runModelTransfer(opts: {
    url: string
    finalPath: string
    policy: Policy
  }): Promise<TransferOutcome>
  runDownload(opts: {
    url: string
    destPath: string
    policy: Policy
  }): Promise<{ ok: true } | { ok: false; error: string }>
  runFetchJSON(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>
  runAssetDownload(opts: {
    url: string
    filename: string
    outputDir: string
    authToken?: string
  }): Promise<{ status: string; error?: string; savePath?: string }>
  rawSessionDownload(opts: {
    url: string
    headers: Record<string, string>
    destPath: string
  }): Promise<{ chain: string[]; state: string }>
}

let app: ElectronApplication
let cleanup: () => Promise<void>
let origin: RedirectServer
let target: RedirectServer
let scratch: string

function resolveRedirects(
  opts: Parameters<Helpers['resolveRedirects']>[0]
): Promise<ResolveResult> {
  return evalWithRetry(() =>
    app.evaluate(
      (_electron, o) => (globalThis as unknown as { __e2e: Helpers }).__e2e.resolveRedirects(o),
      opts
    )
  )
}

function runModelTransfer(
  opts: Parameters<Helpers['runModelTransfer']>[0]
): Promise<TransferOutcome> {
  return evalWithRetry(() =>
    app.evaluate(
      (_electron, o) => (globalThis as unknown as { __e2e: Helpers }).__e2e.runModelTransfer(o),
      opts
    )
  )
}

function helper<
  K extends 'runDownload' | 'runFetchJSON' | 'runAssetDownload' | 'rawSessionDownload'
>(name: K, arg: Parameters<Helpers[K]>[0]): ReturnType<Helpers[K]> {
  return evalWithRetry(() =>
    app.evaluate(
      (_electron, [n, a]) =>
        (globalThis as unknown as { __e2e: Record<string, (x: unknown) => unknown> }).__e2e[n]!(a),
      [name, arg] as const
    )
  ) as ReturnType<Helpers[K]>
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  origin = new RedirectServer('origin-body')
  target = new RedirectServer('target-body')
  await origin.start()
  await target.start()
  scratch = await mkdtemp(path.join(os.tmpdir(), 'download-url-policy-'))
  const launched = await launchLauncherApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false }
  })
  app = launched.application
  cleanup = launched.cleanup
})

test.afterAll(async () => {
  await cleanup?.()
  await origin?.stop()
  await target?.stop()
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

test.beforeEach(() => {
  origin.clear()
  target.clear()
})

test('redirect resolver follows a permitted cross-origin hop @windows @macos @linux', async () => {
  const final = `${target.base('localhost')}/file`
  const result = await resolveRedirects({ url: origin.redirectUrl(final), policy: 'permitted' })
  expect(result).toMatchObject({ ok: true, url: final })
  expect(origin.requestsTo('/redirect')).toHaveLength(1)
  expect(target.requestsTo('/file')).toHaveLength(1)
})

test('redirect resolver refuses a hop with embedded credentials before requesting it @windows @macos @linux', async () => {
  const hop = `http://user:secret@localhost:${new URL(target.base()).port}/file`
  const result = await resolveRedirects({ url: origin.redirectUrl(hop), policy: 'permitted' })
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.error).toContain('not allowed')
  expect(target.requests).toHaveLength(0)
})

test('redirect resolver refuses a hop to the instance-metadata address @windows @macos @linux', async () => {
  const result = await resolveRedirects({
    url: origin.redirectUrl('http://169.254.169.254/latest/meta-data/'),
    policy: 'permitted'
  })
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.error).toContain('not allowed')
})

test('redirect resolver refuses a plain-HTTP public hop under the secure policy without resolving it @windows @macos @linux', async () => {
  const result = await resolveRedirects({
    url: origin.redirectUrl('http://download-url-policy.invalid/model.safetensors'),
    policy: 'secure-public'
  })
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.error).toContain('not allowed')
})

test('redirect resolver refuses a disallowed first URL without any request @windows @macos @linux', async () => {
  const result = await resolveRedirects({
    url: `file:///etc/passwd`,
    policy: 'permitted'
  })
  expect(result.ok).toBe(false)
  expect(origin.requests).toHaveLength(0)
})

test('model transfer completes through a permitted redirect @windows @macos @linux', async () => {
  const finalPath = path.join(scratch, 'allowed', 'model.safetensors')
  const outcome = await runModelTransfer({
    url: origin.redirectUrl(`${target.base('localhost')}/file`),
    finalPath,
    policy: 'permitted'
  })
  expect(outcome.outcome).toBe('completed')
  expect(await readFile(finalPath, 'utf-8')).toBe('target-body')
})

test('model transfer refuses a disallowed redirect hop and writes nothing @windows @macos @linux', async () => {
  const finalPath = path.join(scratch, 'refused', 'model.safetensors')
  const hop = `http://user:secret@localhost:${new URL(target.base()).port}/file`
  const outcome = await runModelTransfer({
    url: origin.redirectUrl(hop),
    finalPath,
    policy: 'permitted'
  })
  expect(outcome).toEqual({
    outcome: 'error',
    error: 'Download failed: redirected to a URL that is not allowed'
  })
  expect(target.requests).toHaveLength(0)
  expect(existsSync(finalPath)).toBe(false)
})

test('model transfer refuses a disallowed first URL @windows @macos @linux', async () => {
  const finalPath = path.join(scratch, 'scheme', 'model.safetensors')
  const outcome = await runModelTransfer({
    url: 'http://download-url-policy.invalid/model.safetensors',
    finalPath,
    policy: 'secure-public'
  })
  expect(outcome).toEqual({
    outcome: 'error',
    error: 'Download failed: the download URL is not allowed'
  })
  expect(existsSync(finalPath)).toBe(false)
})

test('download() follows a permitted redirect and writes the file @windows @macos @linux', async () => {
  const destPath = path.join(scratch, 'dl-allowed', 'bundle.bin')
  const result = await helper('runDownload', {
    url: origin.redirectUrl(`${target.base('localhost')}/file`),
    destPath,
    policy: 'permitted'
  })
  expect(result).toEqual({ ok: true })
  expect(await readFile(destPath, 'utf-8')).toBe('target-body')
})

test('download() checks every redirect hop on the real network stack @windows @macos @linux', async () => {
  const destPath = path.join(scratch, 'dl-refused', 'bundle.bin')
  const hop = `http://user:secret@localhost:${new URL(target.base()).port}/file`
  const result = await helper('runDownload', {
    url: origin.redirectUrl(hop),
    destPath,
    policy: 'permitted'
  })
  expect(result).toEqual({
    ok: false,
    error: 'Download failed: redirected to a URL that is not allowed'
  })
  expect(target.requests).toHaveLength(0)
  expect(existsSync(destPath)).toBe(false)
})

test('download() refuses a plain-HTTP public hop under the secure policy @windows @macos @linux', async () => {
  const destPath = path.join(scratch, 'dl-secure', 'bundle.bin')
  const result = await helper('runDownload', {
    url: origin.redirectUrl('http://download-url-policy.invalid/bundle.bin'),
    destPath,
    policy: 'secure-public'
  })
  expect(result).toEqual({
    ok: false,
    error: 'Download failed: redirected to a URL that is not allowed'
  })
})

test('fetchJSON() refuses a disallowed redirect hop @windows @macos @linux', async () => {
  const hop = `http://user:secret@localhost:${new URL(target.base()).port}/file`
  const result = await helper('runFetchJSON', origin.redirectUrl(hop))
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.error).toContain('not allowed')
  expect(target.requests).toHaveLength(0)
})

test.describe('credentials across redirects (D7)', () => {
  const BEARER = 'Bearer d7-regression-token'

  test('engine baseline: session.downloadURL forwards an explicit Authorization header across origins @windows @macos @linux', async () => {
    const result = await helper('rawSessionDownload', {
      url: origin.redirectUrl(`${target.base('localhost')}/file`),
      headers: { Authorization: BEARER },
      destPath: path.join(scratch, 'd7-raw', 'file.bin')
    })
    expect(result.state).toBe('completed')
    expect(target.requestsTo('/file').map((r) => r.authorization)).toEqual([BEARER])
  })

  test('redirect resolver drops the bearer token on a cross-origin hop @windows @macos @linux', async () => {
    const result = await resolveRedirects({
      url: origin.redirectUrl(`${target.base('localhost')}/file`),
      policy: 'permitted',
      headers: { Authorization: BEARER }
    })
    expect(result).toMatchObject({ ok: true, sendCredentials: false })
    expect(origin.requestsTo('/redirect').map((r) => r.authorization)).toEqual([BEARER])
    expect(target.requestsTo('/file').map((r) => r.authorization)).toEqual([null])
  })

  test('redirect resolver keeps the bearer token on a same-origin hop @windows @macos @linux', async () => {
    const result = await resolveRedirects({
      url: origin.redirectUrl(`${origin.base()}/file`),
      policy: 'permitted',
      headers: { Authorization: BEARER }
    })
    expect(result).toMatchObject({ ok: true, sendCredentials: true })
    expect(origin.requests.map((r) => [r.path, r.authorization])).toEqual([
      ['/redirect', BEARER],
      ['/file', BEARER]
    ])
  })

  test('authenticated asset download does not forward the bearer token to the redirect target @windows @macos @linux', async () => {
    const outputDir = path.join(scratch, 'd7-asset-cross')
    const result = await helper('runAssetDownload', {
      url: origin.redirectUrl(`${target.base('localhost')}/file`),
      filename: 'cross.bin',
      outputDir,
      authToken: 'd7-regression-token'
    })
    expect(result.status).toBe('completed')
    expect(origin.requestsTo('/redirect').every((r) => r.authorization === BEARER)).toBe(true)
    const targetHits = target.requestsTo('/file')
    expect(targetHits.length).toBeGreaterThan(0)
    expect(targetHits.map((r) => r.authorization)).toEqual(targetHits.map(() => null))
    expect(await readFile(result.savePath!, 'utf-8')).toBe('target-body')
  })

  test('authenticated asset download keeps the bearer token on a same-origin redirect @windows @macos @linux', async () => {
    const outputDir = path.join(scratch, 'd7-asset-same')
    const result = await helper('runAssetDownload', {
      url: origin.redirectUrl(`${origin.base()}/file`),
      filename: 'same.bin',
      outputDir,
      authToken: 'd7-regression-token'
    })
    expect(result.status).toBe('completed')
    const fileHits = origin.requestsTo('/file')
    expect(fileHits.length).toBeGreaterThan(0)
    expect(fileHits.every((r) => r.authorization === BEARER)).toBe(true)
    expect(await readFile(result.savePath!, 'utf-8')).toBe('origin-body')
  })
})
