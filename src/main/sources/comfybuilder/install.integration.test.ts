// @vitest-environment node
// Integration test for the ComfyBuilder install glue. Drives the real
// `installComfyBuilderPipeline` against the mock Builder API: the artifact is
// downloaded over HTTP (electron `net` is bridged to node http so the real
// `download()` streams bytes to disk), extracted with the real 7za nested
// extractor, and its manifest validated for real. Only the reused standalone
// post-extract phases are stubbed at their boundary (a real `uv venv` +
// package copy is infeasible here). Also covers the invalid-manifest cleanup
// and the block-at-install (zero download) guard.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ClientRequest } from 'node:http'
import { create as tarCreate } from 'tar'

// Count net.request calls so the block test can prove zero download requests;
// referenced from the hoisted electron mock factory, so it must be hoisted too.
const netState = vi.hoisted(() => ({ requestCount: 0 }))

// electron `net` is inert under vitest; bridge it to node http so the real
// `download()` actually streams bytes from the mock server. The other members
// are stubbed only so transitively-loaded modules can import them.
vi.mock('electron', async () => {
  const http = (await vi.importActual('node:http')) as { request(url: string): ClientRequest }
  return {
    app: {
      isPackaged: false,
      getPath: (_name: string) => os.tmpdir(),
      getVersion: () => '0.0.0-test',
      getLocale: () => 'en',
    },
    ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
    dialog: {},
    shell: {},
    BrowserWindow: { getAllWindows: () => [] },
    nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
    net: {
      request: (url: string) => {
        netState.requestCount += 1
        return http.request(url)
      },
    },
  }
})

// Keep download()'s Chinese-mirror retry path off.
vi.mock('../../settings', () => ({
  get: vi.fn(() => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
}))

// Drive the signed-in access token used by the Bearer download path.
vi.mock('../../comfybuilder/tokenStore', () => ({
  loadTokens: vi.fn(),
}))

import { install, installComfyBuilderPipeline, ComfyBuilderInstallError } from './install'
import type { InstallPipelineTools } from './install'
import type { PipelineOptionMeta } from './index'
import { loadTokens } from '../../comfybuilder/tokenStore'
import { createCache } from '../../lib/cache'
import type { Artifact } from '../../comfybuilder/dto'
import type { InstallTools } from '../../types/sources'
import type { AuthTokens } from '../../comfybuilder/types'
import type { InstallationRecord } from '../../installations'
import {
  ensureMockArtifact,
  MOCK_ARTIFACT_PATH,
  startMockBuilderApi,
} from '../../../test/comfybuilder/mockServers'
import type { MockServer } from '../../../test/comfybuilder/mockServers'

function makeTokens(): AuthTokens {
  return { accessToken: 'test-access-token', expiresAt: Date.now() + 3_600_000 }
}

function makeArtifact(pipelineId: string, deploymentId: string, sizeBytes: number): Artifact {
  return {
    artifact_id: `builds/${deploymentId}/linux-nvidia-targz/1.0.0.tar.gz`,
    filename: '1.0.0.tar.gz',
    download_url: `/api/v1/pipelines/${pipelineId}/deployments/${deploymentId}/artifact`,
    checksum: 'sha256:unverified-in-this-test',
    size_bytes: sizeBytes,
  }
}

function makeInstallation(installPath: string, pipelineId: string): InstallationRecord {
  return {
    id: 'inst-cb-1',
    name: 'ComfyBuilder Test',
    createdAt: new Date(0).toISOString(),
    installPath,
    sourceId: 'comfybuilder',
    pipelineId,
    pipelineName: 'Test Pipeline',
  }
}

function makeTools(cacheDir: string): InstallPipelineTools {
  return {
    sendProgress: vi.fn(),
    cache: createCache(cacheDir, 5),
  }
}

function makeInstallTools(cacheDir: string): InstallTools {
  return {
    sendProgress: vi.fn(),
    download: vi.fn(async () => ''),
    cache: createCache(cacheDir, 5),
    extract: vi.fn(async () => {}),
  }
}

/** Build a tarball with `standalone-env/` + `ComfyUI/` but NO `manifest.json`. */
async function writeBadArtifact(destPath: string): Promise<void> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-bad-src-'))
  try {
    fs.mkdirSync(path.join(staging, 'standalone-env', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'standalone-env', 'bin', 'python3'), '')
    fs.mkdirSync(path.join(staging, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'ComfyUI', 'main.py'), '')
    // Deliberately no manifest.json — the install must reject + clean up.
    await tarCreate(
      { gzip: true, file: destPath, cwd: staging, portable: true, mtime: new Date('2026-01-01T00:00:00.000Z') },
      ['standalone-env', 'ComfyUI'],
    )
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

describe('installComfyBuilderPipeline', () => {
  let goodApi: MockServer
  let badApi: MockServer
  let goodSize: number
  let badSize: number
  let fixturesDir: string
  let tmpRoot: string

  beforeAll(async () => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fixtures-'))
    await ensureMockArtifact()
    goodSize = fs.statSync(MOCK_ARTIFACT_PATH).size

    const badFixturePath = path.join(fixturesDir, 'bad-artifact.tar.gz')
    await writeBadArtifact(badFixturePath)
    badSize = fs.statSync(badFixturePath).size

    goodApi = await startMockBuilderApi()
    badApi = await startMockBuilderApi({ artifactPath: badFixturePath })
  })

  afterAll(async () => {
    await goodApi.stop()
    await badApi.stop()
    fs.rmSync(fixturesDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-install-'))
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('happy path: downloads, extracts, validates the manifest, and reaches the venv/package phase', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())
    const installPath = path.join(tmpRoot, 'install')
    const artifact = makeArtifact('pipe-success', 'dep-success-1', goodSize)
    const meta: PipelineOptionMeta = {
      installable: true,
      deploymentId: 'dep-success-1',
      version: '1.0.0',
      artifact,
    }
    const installation = makeInstallation(installPath, 'pipe-success')
    const tools = makeTools(path.join(tmpRoot, 'cache'))

    await expect(
      installComfyBuilderPipeline({ installation, meta, tools, baseUrl: goodApi.baseUrl }),
    ).resolves.toBeUndefined()

    // The downloaded artifact was fully extracted + validated into the install directory.
    expect(fs.statSync(path.join(installPath, 'standalone-env')).isDirectory()).toBe(true)
    expect(fs.statSync(path.join(installPath, 'ComfyUI')).isDirectory()).toBe(true)
    expect(fs.existsSync(path.join(installPath, 'manifest.json'))).toBe(true)
  })

  it('invalid manifest: aborts with a manifest-validation error and removes partial extracted files', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())
    const installPath = path.join(tmpRoot, 'install')
    const artifact = makeArtifact('pipe-bad', 'dep-bad-1', badSize)
    const meta: PipelineOptionMeta = {
      installable: true,
      deploymentId: 'dep-bad-1',
      version: '9.9.9',
      artifact,
    }
    const installation = makeInstallation(installPath, 'pipe-bad')
    const tools = makeTools(path.join(tmpRoot, 'cache'))

    let caught: unknown
    try {
      await installComfyBuilderPipeline({ installation, meta, tools, baseUrl: badApi.baseUrl })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ComfyBuilderInstallError)
    expect((caught as ComfyBuilderInstallError).kind).toBe('invalid-manifest')

    // Partial extracted files were cleaned up.
    expect(fs.existsSync(path.join(installPath, 'standalone-env'))).toBe(false)
    expect(fs.existsSync(path.join(installPath, 'ComfyUI'))).toBe(false)
    expect(fs.existsSync(path.join(installPath, 'manifest.json'))).toBe(false)
  })

  it('block-at-install: throws no-successful-build and makes zero download requests', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const cacheDir = path.join(tmpRoot, 'cache')
    const meta: PipelineOptionMeta = { installable: false, reason: 'no-successful-build' }
    const installation = makeInstallation(installPath, 'pipe-failed')
    const tools = makeTools(cacheDir)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const netBefore = netState.requestCount

    let caught: unknown
    try {
      await installComfyBuilderPipeline({ installation, meta, tools, baseUrl: goodApi.baseUrl })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ComfyBuilderInstallError)
    expect((caught as ComfyBuilderInstallError).kind).toBe('no-successful-build')

    // Zero network activity: no fetch (token mint), no net.request (download),
    // and nothing was staged or extracted on disk.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(netState.requestCount).toBe(netBefore)
    expect(fs.existsSync(cacheDir)).toBe(false)
    expect(fs.existsSync(installPath)).toBe(false)

    fetchSpy.mockRestore()
  })

  it('install(inst, ctx): reconstructs meta and blocks an un-installable record before any download', async () => {
    const installPath = path.join(tmpRoot, 'install')
    const cacheDir = path.join(tmpRoot, 'cache')
    const installation: InstallationRecord = {
      ...makeInstallation(installPath, 'pipe-failed'),
      installable: false,
      reason: 'no-successful-build',
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const netBefore = netState.requestCount

    let caught: unknown
    try {
      await install(installation, makeInstallTools(cacheDir))
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ComfyBuilderInstallError)
    expect((caught as ComfyBuilderInstallError).kind).toBe('no-successful-build')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(netState.requestCount).toBe(netBefore)
    expect(fs.existsSync(cacheDir)).toBe(false)
    expect(fs.existsSync(installPath)).toBe(false)

    fetchSpy.mockRestore()
  })
})
