// @vitest-environment node
//
// Integration test for the ComfyBuilder install glue.
//
// (a) CI path — drives the real `installArtifact` (+ the `install()` record
//     wrapper) against a small FABRICATED `venv/`/`ComfyUI/` tarball (the shape
//     comfy-builder tars; no in-archive manifest) served by the mock Builder API:
//     the artifact is downloaded over HTTP (electron `net` is bridged to node
//     http so the real `download()` streams bytes to disk), extracted with the
//     real 7za nested extractor, and its layout validated for real. The reused
//     standalone post-extract phases are NOT run here (a real `uv venv` + package
//     copy is infeasible in CI).
//
// (b) Real-archive boot — opt-in, gated on darwin AND `CB_TEST_ARCHIVE`. Points
//     the mock at the real archive, runs the REAL `installArtifact` + standalone
//     `postInstall`, then spawns the launch command and polls `/object_info`,
//     asserting ComfyUI reports > 0 nodes.
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { ClientRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { create as tarCreate } from 'tar'

// electron `net` is inert under vitest; bridge it to node http so the real
// `download()` streams bytes from the mock server. Other members are stubbed
// only so transitively-loaded modules can import them.
vi.mock('electron', async () => {
  const nodeHttp = (await vi.importActual('node:http')) as { request(url: string): ClientRequest }
  return {
    app: {
      isPackaged: false,
      getPath: (_name: string) => os.tmpdir(),
      getVersion: () => '0.0.0-test',
      getLocale: () => 'en',
      getName: () => 'comfy-desktop-test',
      on: vi.fn(),
    },
    ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
    dialog: {},
    shell: {},
    BrowserWindow: { getAllWindows: () => [] },
    nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
    net: { request: (url: string) => nodeHttp.request(url) },
  }
})

// Keep download()'s Chinese-mirror retry path off.
vi.mock('../../settings', () => ({
  get: vi.fn(() => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
}))

import { ComfyBuilderInstallError, install, installArtifact } from './install'
import type { InstallArtifactTools } from './install'
import { createCache } from '../../lib/cache'
import type { Artifact } from '../../comfybuilder/types'
import type { InstallationRecord } from '../../installations'
import type { InstallTools } from '../../types/sources'
import { startMockBuilderApi } from '../../../test/comfybuilder/mockBuilderApi'
import type { MockBuilderApi } from '../../../test/comfybuilder/mockBuilderApi'

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return { id: 'artifact-1', os: 'mac', gpu: 'mps', accelVariant: '', status: 'succeeded', ...overrides }
}

function makeInstallation(installPath: string): InstallationRecord {
  return {
    id: 'inst-cb-1',
    name: 'ComfyBuilder Test',
    createdAt: new Date(0).toISOString(),
    installPath,
    sourceId: 'comfybuilder',
  }
}

function makeArtifactTools(cacheDir: string): InstallArtifactTools {
  return { sendProgress: vi.fn(), cache: createCache(cacheDir, 5) }
}

function makeInstallTools(cacheDir: string): InstallTools {
  return {
    sendProgress: vi.fn(),
    download: vi.fn(async () => ''),
    cache: createCache(cacheDir, 5),
    extract: vi.fn(async () => {}),
  }
}

/** Hex sha256 of a file, matching what the artifact's `outputSha256` carries. */
function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

/**
 * Build a fabricated archive in the shape comfy-builder actually tars
 * (buildexec/assemble.go): top-level `venv/` + `ComfyUI/` + a lockfile, and NO
 * in-archive manifest (it's DB/GCS-sealed). Omit `withVenv` for the bad case
 * (a build that failed to produce the env dir).
 */
async function writeFixtureArtifact(destPath: string, withVenv: boolean): Promise<void> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fixture-src-'))
  try {
    fs.mkdirSync(path.join(staging, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'ComfyUI', 'main.py'), '')
    fs.writeFileSync(path.join(staging, 'uv.lock'), 'version = 1\n')
    const entries = ['ComfyUI', 'uv.lock']
    if (withVenv) {
      fs.mkdirSync(path.join(staging, 'venv', 'bin'), { recursive: true })
      fs.writeFileSync(path.join(staging, 'venv', 'bin', 'python3'), '')
      entries.push('venv')
    }
    await tarCreate(
      { gzip: true, file: destPath, cwd: staging, portable: true, mtime: new Date('2026-01-01T00:00:00.000Z') },
      entries,
    )
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

describe('installArtifact (fabricated fixture)', () => {
  let goodApi: MockBuilderApi
  let badApi: MockBuilderApi
  let garbageApi: MockBuilderApi
  let fixturesDir: string
  let tmpRoot: string
  let goodSha: string
  let badSha: string
  let garbageSha: string

  beforeAll(async () => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fixtures-'))
    const goodPath = path.join(fixturesDir, 'good-artifact.tar.gz')
    const badPath = path.join(fixturesDir, 'bad-artifact.tar.gz')
    const garbagePath = path.join(fixturesDir, 'garbage-artifact.tar.gz')
    await writeFixtureArtifact(goodPath, true)
    await writeFixtureArtifact(badPath, false)
    // Non-archive bytes: sha verification passes, extraction fails.
    fs.writeFileSync(garbagePath, Buffer.from('not a real tar.gz archive'))
    goodSha = sha256File(goodPath)
    badSha = sha256File(badPath)
    garbageSha = sha256File(garbagePath)
    goodApi = await startMockBuilderApi({ archivePath: goodPath })
    badApi = await startMockBuilderApi({ archivePath: badPath })
    garbageApi = await startMockBuilderApi({ archivePath: garbagePath })
  })

  afterAll(async () => {
    await goodApi.stop()
    await badApi.stop()
    await garbageApi.stop()
    fs.rmSync(fixturesDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-install-'))
  })
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('resolves, downloads, extracts, and validates the layout', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const installation = makeInstallation(installPath)
    await expect(
      installArtifact({
        installation,
        artifact: makeArtifact({ outputSha256: goodSha }),
        tools: makeArtifactTools(path.join(tmpRoot, 'cache')),
        baseUrl: goodApi.baseUrl,
      }),
    ).resolves.toBeUndefined()

    expect(fs.statSync(path.join(installPath, 'venv')).isDirectory()).toBe(true)
    expect(fs.statSync(path.join(installPath, 'ComfyUI')).isDirectory()).toBe(true)
  })

  it('aborts with invalid-layout and removes partial extracted files', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const installation = makeInstallation(installPath)

    let caught: unknown
    try {
      await installArtifact({
        installation,
        artifact: makeArtifact({ id: 'artifact-bad', outputSha256: badSha }),
        tools: makeArtifactTools(path.join(tmpRoot, 'cache')),
        baseUrl: badApi.baseUrl,
      })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ComfyBuilderInstallError)
    expect((caught as ComfyBuilderInstallError).kind).toBe('invalid-layout')
    expect(fs.existsSync(path.join(installPath, 'venv'))).toBe(false)
    expect(fs.existsSync(path.join(installPath, 'ComfyUI'))).toBe(false)
  })

  it('install(inst, tools): reads the artifact off the record and installs', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const installation: InstallationRecord = {
      ...makeInstallation(installPath),
      artifact: makeArtifact({ outputSha256: goodSha }),
      comfybuilderBaseUrl: goodApi.baseUrl,
    }
    await expect(install(installation, makeInstallTools(path.join(tmpRoot, 'cache')))).resolves.toBeUndefined()
    expect(fs.existsSync(path.join(installPath, 'venv'))).toBe(true)
  })

  it('install(inst, tools): throws invalid-artifact when the record has no artifact', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const installation = makeInstallation(installPath)
    let caught: unknown
    try {
      await install(installation, makeInstallTools(path.join(tmpRoot, 'cache')))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ComfyBuilderInstallError)
    expect((caught as ComfyBuilderInstallError).kind).toBe('invalid-artifact')
    expect(fs.existsSync(installPath)).toBe(false)
  })

  it('installs without outputSha256 (e2e verify-if-present: staging exposes no hash)', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const installation = makeInstallation(installPath)

    // No outputSha256 → download proceeds unverified (e2e-only relaxation).
    await expect(
      installArtifact({
        installation,
        artifact: makeArtifact(), // no outputSha256
        tools: makeArtifactTools(path.join(tmpRoot, 'cache')),
        baseUrl: goodApi.baseUrl,
      }),
    ).resolves.toBeUndefined()
    expect(fs.statSync(path.join(installPath, 'venv')).isDirectory()).toBe(true)
  })

  it('cleans up the install dir when extraction fails on a garbage archive', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const installation = makeInstallation(installPath)

    // sha matches (verification passes), but the bytes are not a real archive so
    // extraction throws -> cleanupPartialInstall must remove the extracted roots.
    await expect(
      installArtifact({
        installation,
        artifact: makeArtifact({ id: 'artifact-garbage', outputSha256: garbageSha }),
        tools: makeArtifactTools(path.join(tmpRoot, 'cache')),
        baseUrl: garbageApi.baseUrl,
      }),
    ).rejects.toThrow()

    const leftover = fs.existsSync(installPath) ? fs.readdirSync(installPath) : []
    expect(leftover).toEqual([])
  })
})

// --- (b) opt-in real-archive boot -------------------------------------------

const CB_TEST_ARCHIVE = process.env.CB_TEST_ARCHIVE
const runRealBoot = process.platform === 'darwin' && !!CB_TEST_ARCHIVE

/** Poll `/object_info` until ComfyUI reports > 0 nodes or the budget elapses. */
function pollObjectInfo(port: number, budgetMs: number): Promise<number> {
  const deadline = Date.now() + budgetMs
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get({ host: '127.0.0.1', port, path: '/object_info', timeout: 5000 }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
            const count = Object.keys(parsed).length
            if (res.statusCode === 200 && count > 0) return resolve(count)
          } catch {
            // not ready yet
          }
          retry()
        })
      })
      req.on('error', retry)
      req.on('timeout', () => req.destroy())
    }
    const retry = (): void => {
      if (Date.now() > deadline) return reject(new Error('ComfyUI did not report nodes before the deadline'))
      setTimeout(attempt, 1500)
    }
    attempt()
  })
}

describe.runIf(runRealBoot)('installArtifact + postInstall real-archive boot', () => {
  let api: MockBuilderApi
  let tmpRoot: string
  let child: ChildProcess | undefined

  beforeAll(async () => {
    api = await startMockBuilderApi({ archivePath: CB_TEST_ARCHIVE! })
  })
  afterAll(async () => {
    if (child && !child.killed) child.kill('SIGKILL')
    await api.stop()
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('downloads → extracts → validates → builds env → boots ComfyUI (> 0 nodes)', async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-boot-'))
    const installPath = path.join(tmpRoot, 'install')
    const installation: InstallationRecord = { ...makeInstallation(installPath), installPath, version: 'master' }

    // Real download/extract/validate from the real archive (sha now mandatory).
    await installArtifact({
      installation,
      artifact: makeArtifact({ id: 'mac-mps-real', outputSha256: sha256File(CB_TEST_ARCHIVE!) }),
      tools: makeArtifactTools(path.join(tmpRoot, 'cache')),
      baseUrl: api.baseUrl,
    })

    // Env-reshape seam (test-only): main's createEnv runs
    // `<installPath>/standalone-env/bin/uv`, which the real archive does NOT
    // bundle. Symlink the system uv so postInstall's `uv venv` can run.
    // TODO(builder): archive must bundle standalone-env/bin/uv (reshape bridge).
    const uvTarget = path.join(installPath, 'standalone-env', 'bin', 'uv')
    if (!fs.existsSync(uvTarget)) {
      const systemUv = execFileSync('which', ['uv']).toString().trim()
      fs.symlinkSync(systemUv, uvTarget)
      console.warn(`TODO(builder): archive must bundle standalone-env/bin/uv (reshape bridge). Symlinked system uv ${systemUv} for this test.`)
    }

    // Real standalone postInstall: uv venv + package copy (no auto-update, since
    // the record has no autoUpdateComfyUI, so the torch sync phase is skipped).
    const { postInstall } = await import('../standalone/install')
    await postInstall(installation, { sendProgress: vi.fn(), update: async () => {} })

    // Launch via the reused standalone launch command and poll /object_info.
    const { standalone } = await import('../standalone')
    const port = 18188
    const launchInstallation: InstallationRecord = { ...installation, launchArgs: `--cpu --port ${port}` }
    const launch = standalone.getLaunchCommand(launchInstallation)
    expect(launch?.cmd).toBeTruthy()

    child = spawn(launch!.cmd!, launch!.args ?? [], { cwd: launch!.cwd, stdio: 'inherit' })

    const nodeCount = await pollObjectInfo(port, 600_000)
    console.log(`ComfyUI booted with ${nodeCount} nodes`)
    expect(nodeCount).toBeGreaterThan(0)
  }, 1_200_000)
})
