// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { ClientRequest, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture every net.request URL + the headers set on it, so a test can assert
// which request carried `Authorization: Bearer`.
const netCapture = vi.hoisted(() => ({
  requests: [] as Array<{ url: string; headers: Record<string, string> }>,
}))

// download() uses Electron's `net`, which is inert outside a running Electron
// runtime; bridge it to Node's real `http` so bytes actually flow to disk.
vi.mock('electron', async () => {
  const http = (await vi.importActual('node:http')) as { request(url: string): ClientRequest }
  return {
    net: {
      request(url: string) {
        const req = http.request(url)
        const headers: Record<string, string> = {}
        const originalSetHeader = req.setHeader.bind(req)
        req.setHeader = ((name: string, value: number | string | readonly string[]) => {
          headers[name] = String(value)
          return originalSetHeader(name, value)
        }) as typeof req.setHeader
        netCapture.requests.push({ url, headers })
        return req
      },
    },
  }
})

// Keep download()'s R2-mirror path disabled (useChineseMirrors off).
vi.mock('../settings', () => ({ get: () => undefined, set: () => {} }))

// Drive the access token from the test rather than the encrypted store.
vi.mock('./tokenStore', () => ({ loadTokens: vi.fn() }))

import { ensureMockArtifact, MOCK_ARTIFACT_PATH, startMockBuilderApi } from '../../test/comfybuilder/mockServers'
import type { MockServer } from '../../test/comfybuilder/mockServers'
import { downloadPipelineArtifact } from './artifactDownload'
import type { Artifact } from './dto'
import { loadTokens } from './tokenStore'
import type { AuthTokens } from './types'

const ACCESS_TOKEN = 'access-token-super-secret-value-1234567890'

function makeTokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  return { accessToken: ACCESS_TOKEN, refreshToken: 'refresh-token-1', expiresAt: Date.now() + 3_600_000, ...overrides }
}

function makeArtifact(pipelineId: string, deploymentId: string, sizeBytes: number): Artifact {
  return {
    artifact_id: `builds/${deploymentId}/linux-nvidia-targz/1.0.0.tar.gz`,
    filename: '1.0.0.tar.gz',
    download_url: `/api/v1/pipelines/${pipelineId}/deployments/${deploymentId}/artifact`,
    checksum: 'sha256:0',
    size_bytes: sizeBytes,
  }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') resolvePromise(`http://127.0.0.1:${address.port}`)
      else reject(new Error('mock server did not expose a numeric port'))
    })
  })
}

function makeStop(server: Server): () => Promise<void> {
  return () =>
    new Promise((resolvePromise, reject) => {
      server.closeAllConnections()
      server.close((err) => (err ? reject(err) : resolvePromise()))
    })
}

interface TokenArtifactServer {
  baseUrl: string
  minted: string[]
  downloadedTokens: string[]
  rejectedTokens: string[]
  counters: { direct: number; download: number }
  stop: () => Promise<void>
}

// A stand-in Builder that issues UNIQUE, single-use download tokens (unlike the
// shared mock's fixed token) so retries can be proven to mint fresh ones. It can
// fail the direct Bearer route (forcing the token fallback) and the first token
// download (forcing a retry).
async function startTokenArtifactServer(opts: {
  allowDirect: boolean
  failFirstTokenDownload: boolean
}): Promise<TokenArtifactServer> {
  await ensureMockArtifact()
  const size = statSync(MOCK_ARTIFACT_PATH).size
  const minted: string[] = []
  const downloadedTokens: string[] = []
  const rejectedTokens: string[] = []
  const validTokens = new Set<string>()
  const counters = { direct: 0, download: 0 }
  let tokenCounter = 0

  const streamFixture = (res: ServerResponse): void => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(size) })
    createReadStream(MOCK_ARTIFACT_PATH).pipe(res)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const segments = url.pathname.split('/').filter(Boolean)
    const auth = req.headers.authorization
    const hasBearer = typeof auth === 'string' && /^Bearer\s+.+/i.test(auth)

    if (req.method === 'GET' && segments.length === 8 && segments[6] === 'artifact' && segments[7] === 'download') {
      counters.download += 1
      const token = url.searchParams.get('token') ?? ''
      if (!validTokens.has(token)) {
        rejectedTokens.push(token)
        res.writeHead(401)
        res.end()
        return
      }
      validTokens.delete(token)
      downloadedTokens.push(token)
      if (opts.failFirstTokenDownload && counters.download === 1) {
        res.writeHead(500)
        res.end()
        return
      }
      streamFixture(res)
      return
    }

    if (req.method === 'POST' && segments.length === 8 && segments[6] === 'artifact' && segments[7] === 'download-token') {
      if (!hasBearer) {
        res.writeHead(401)
        res.end()
        return
      }
      tokenCounter += 1
      const token = `dl-token-${tokenCounter}`
      minted.push(token)
      validTokens.add(token)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ token, expires_at: new Date(Date.now() + 1_800_000).toISOString() }))
      return
    }

    if (req.method === 'GET' && segments.length === 7 && segments[6] === 'artifact') {
      counters.direct += 1
      if (!opts.allowDirect || !hasBearer) {
        res.writeHead(opts.allowDirect ? 401 : 403)
        res.end()
        return
      }
      streamFixture(res)
      return
    }

    res.writeHead(404)
    res.end()
  })

  const baseUrl = await listen(server)
  return { baseUrl, minted, downloadedTokens, rejectedTokens, counters, stop: makeStop(server) }
}

describe('comfybuilder artifactDownload', () => {
  let api: MockServer
  let fixtureSize = 0
  let tmpDir: string

  beforeAll(async () => {
    await ensureMockArtifact()
    fixtureSize = statSync(MOCK_ARTIFACT_PATH).size
    api = await startMockBuilderApi()
  })

  afterAll(async () => {
    await api.stop()
  })

  beforeEach(() => {
    netCapture.requests.length = 0
    vi.mocked(loadTokens).mockReset()
    tmpDir = mkdtempSync(join(tmpdir(), 'artifact-download-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('streams the artifact to disk over a Bearer-authenticated request', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())
    const artifact = makeArtifact('pipe-success', 'dep-success-1', fixtureSize)
    const destPath = join(tmpDir, 'artifact.tar.gz')

    await downloadPipelineArtifact({
      pipelineId: 'pipe-success',
      deploymentId: 'dep-success-1',
      artifact,
      destPath,
      baseUrl: api.baseUrl,
    })

    expect(statSync(destPath).size).toBe(fixtureSize)

    const authHeader = netCapture.requests.find((r) => r.headers.Authorization)?.headers.Authorization
    expect(authHeader).toBe(`Bearer ${ACCESS_TOKEN}`)

    const listing = execFileSync('tar', ['tzf', destPath], { encoding: 'utf8' })
    expect(listing).toContain('standalone-env/')
    expect(listing).toContain('ComfyUI/')
    expect(listing).toContain('manifest.json')
  })

  it('falls back to a download token and mints a fresh one on retry', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())
    const server = await startTokenArtifactServer({ allowDirect: false, failFirstTokenDownload: true })
    try {
      const artifact = makeArtifact('pipe-success', 'dep-success-1', fixtureSize)
      const destPath = join(tmpDir, 'fallback.tar.gz')

      await downloadPipelineArtifact({
        pipelineId: 'pipe-success',
        deploymentId: 'dep-success-1',
        artifact,
        destPath,
        baseUrl: server.baseUrl,
      })

      expect(server.counters.direct).toBe(1)
      expect(server.minted).toHaveLength(2)
      expect(server.minted[0]).not.toBe(server.minted[1])
      expect(server.downloadedTokens).toEqual([server.minted[0], server.minted[1]])
      expect(server.rejectedTokens).toEqual([])

      expect(statSync(destPath).size).toBe(fixtureSize)
      const listing = execFileSync('tar', ['tzf', destPath], { encoding: 'utf8' })
      expect(listing).toContain('manifest.json')
    } finally {
      await server.stop()
    }
  })

  it('never writes the access token or download token to logs', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())
    const server = await startTokenArtifactServer({ allowDirect: false, failFirstTokenDownload: false })

    const logged: string[] = []
    const record = (...args: unknown[]): void => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    }
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(record),
      vi.spyOn(console, 'info').mockImplementation(record),
      vi.spyOn(console, 'warn').mockImplementation(record),
      vi.spyOn(console, 'error').mockImplementation(record),
      vi.spyOn(console, 'debug').mockImplementation(record),
    ]

    try {
      const artifact = makeArtifact('pipe-success', 'dep-success-1', fixtureSize)
      const destPath = join(tmpDir, 'logsafe.tar.gz')
      await downloadPipelineArtifact({
        pipelineId: 'pipe-success',
        deploymentId: 'dep-success-1',
        artifact,
        destPath,
        baseUrl: server.baseUrl,
      })

      const output = logged.join('\n')
      expect(output).toContain('downloading pipeline artifact')
      expect(output).not.toContain(ACCESS_TOKEN)
      expect(server.minted.length).toBeGreaterThan(0)
      for (const token of server.minted) {
        expect(output).not.toContain(token)
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
      await server.stop()
    }
  })
})
