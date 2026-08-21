/**
 * E2E: staging a distribution's models in the real app.
 *
 * A distribution archive carries no model weights, so the comfybuilder install
 * downloads the version's declared models into `<installPath>/ComfyUI/models/
 * <type>/<filename>` before launch. This drives the REAL staging code (real
 * Electron download, real fs, real sha256) in the real main process, decoupled
 * from the archive/auth path via the E2E hook, and serves the model bytes from a
 * local HTTP server so the run is hermetic and deterministic.
 *
 * The manifest source is the `COMFY_BUILDER_MODELS_MANIFEST` env seam (a file the
 * test rewrites per case), which is exactly how the mocked manifest is injected
 * until the builder endpoint is deployed.
 */

import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

// Two deterministic "model" payloads served locally.
const DECODER = Buffer.from('taesd-decoder-bytes-fixture')
const ENCODER = Buffer.from('taesd-encoder-bytes-fixture')

let server: Server
let baseUrl: string
let manifestFile: string
let ctx: AppContext
const tmpDirs: string[] = []

function freshInstall(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-models-e2e-'))
  tmpDirs.push(dir)
  mkdirSync(path.join(dir, 'ComfyUI'), { recursive: true })
  return dir
}

/** Ask the app to run the real staging against installPath, reading the manifest
 *  from the env-pointed file the test controls. */
async function stage(
  installPath: string
): Promise<{ staged?: string[]; error?: string; kind?: string }> {
  // Deliberately not retried: staging mutates the install's model tree, so a
  // retry after a lost result could run the real staging twice.
  return ctx.app.evaluate(
    async (_electron, arg) => {
      const helpers = (
        globalThis as unknown as {
          __e2e?: { stageBuildModels: (o: unknown) => Promise<unknown> }
        }
      ).__e2e
      if (!helpers) throw new Error('__e2e not registered')
      return helpers.stageBuildModels(arg) as Promise<{
        staged?: string[]
        error?: string
        kind?: string
      }>
    },
    { installPath, buildId: 'd-e2e', version: '1' }
  )
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (req.url === '/decoder') return res.end(DECODER)
      if (req.url === '/encoder') return res.end(ENCODER)
      res.statusCode = 404
      res.end()
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
      resolve()
    })
  })
  manifestFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'cb-mf-e2e-')), 'manifest.json')
  writeFileSync(manifestFile, JSON.stringify({ models: [] }))
  process.env.COMFY_BUILDER_MODELS_MANIFEST = manifestFile
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  await new Promise<void>((r) => server.close(() => r()))
  delete process.env.COMFY_BUILDER_MODELS_MANIFEST
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  rmSync(path.dirname(manifestFile), { recursive: true, force: true })
})

test('stages verified models into ComfyUI/models/<type>/<filename> @windows @macos', async () => {
  writeFileSync(
    manifestFile,
    JSON.stringify({
      models: [
        {
          type: 'vae_approx',
          filename: 'taesd_decoder.pth',
          sha256: sha(DECODER),
          downloadUrl: `${baseUrl}/decoder`
        },
        {
          type: 'vae_approx',
          filename: 'taesd_encoder.pth',
          sha256: sha(ENCODER),
          downloadUrl: `${baseUrl}/encoder`
        }
      ]
    })
  )
  const install = freshInstall()
  const res = await stage(install)
  expect(res.error, res.error).toBeUndefined()
  expect(res.staged).toEqual(['vae_approx/taesd_decoder.pth', 'vae_approx/taesd_encoder.pth'])

  const decoder = path.join(install, 'ComfyUI', 'models', 'vae_approx', 'taesd_decoder.pth')
  const encoder = path.join(install, 'ComfyUI', 'models', 'vae_approx', 'taesd_encoder.pth')
  expect(existsSync(decoder)).toBe(true)
  expect(readFileSync(decoder)).toEqual(DECODER)
  expect(existsSync(encoder)).toBe(true)
  // No leftover partials.
  expect(existsSync(`${decoder}.partial`)).toBe(false)
})

test('fails the stage and leaves no file when a model checksum does not match @windows @macos', async () => {
  writeFileSync(
    manifestFile,
    JSON.stringify({
      models: [
        {
          type: 'checkpoints',
          filename: 'bad.safetensors',
          sha256: sha(Buffer.from('other')),
          downloadUrl: `${baseUrl}/decoder`
        }
      ]
    })
  )
  const install = freshInstall()
  const res = await stage(install)
  expect(res.kind).toBe('model-checksum-mismatch')
  const dest = path.join(install, 'ComfyUI', 'models', 'checkpoints', 'bad.safetensors')
  expect(existsSync(dest)).toBe(false)
  expect(existsSync(`${dest}.partial`)).toBe(false)
})

test('stages nothing for an empty manifest @windows @macos', async () => {
  writeFileSync(manifestFile, JSON.stringify({ models: [] }))
  const install = freshInstall()
  const res = await stage(install)
  expect(res.staged).toEqual([])
  expect(existsSync(path.join(install, 'ComfyUI', 'models'))).toBe(false)
})
