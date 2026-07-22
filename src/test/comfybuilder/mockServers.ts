// Mock OAuth issuer + mock ComfyBuilder API for integration tests.
//
// Both `startMockOAuthIssuer()` and `startMockBuilderApi()` bind to an
// ephemeral loopback port (port 0) and return `{ baseUrl, stop() }`. `stop()`
// force-closes keep-alive sockets so a test run never hangs on teardown.
//
// The responses are shaped to satisfy the real Desktop client contract:
//   - OAuth: authorization-code + PKCE (S256), matching `main/comfybuilder/pkce`
//   - Builder API: pipelines/deployments/artifact parseable by
//     `main/comfybuilder/dto`
// so downstream tests can exercise the genuine client code against the mock.

import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { create as tarCreate } from 'tar'

import type { Deployment, Pipeline } from '../../main/comfybuilder/dto'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** Absolute path to the committed fixture artifact tarball. */
export const MOCK_ARTIFACT_PATH = resolve(MODULE_DIR, 'fixtures', 'mock-artifact.tar.gz')

const DEFAULT_CLAIMS = {
  workspace_id: 'ws-test',
  email: 'test@example.com',
  workspace_type: 'personal',
  role: 'owner',
} as const

/** A running mock server bound to a random loopback port. */
export interface MockServer {
  baseUrl: string
  stop(): Promise<void>
}

export interface MockOAuthIssuerOptions {
  /** `iss` claim + JWKS issuer. Defaults to the server's own base URL. */
  issuer?: string
  /** `aud` claim. Defaults to `comfy-cloud`. */
  audience?: string
  /** Access-token lifetime in seconds. Defaults to 3600. */
  expiresInSeconds?: number
  /** Extra/override JWT claims merged on top of the defaults. */
  extraClaims?: Record<string, unknown>
}

export interface MockBuilderApiOptions {
  /** Path to the artifact tarball to stream. Defaults to the committed fixture. */
  artifactPath?: string
  /** Require `Authorization: Bearer` on protected routes. Defaults to true. */
  requireAuth?: boolean
}

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input, 'utf8') : input).toString('base64url')
}

/** Bind an HTTP server to a random loopback port and resolve its base URL. */
function listen(server: Server): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        resolvePromise(`http://127.0.0.1:${address.port}`)
      } else {
        reject(new Error('mock server did not expose a numeric port'))
      }
    })
  })
}

/** Force-close keep-alive sockets, then close the server (prevents test hangs). */
function makeStop(server: Server): () => Promise<void> {
  return () =>
    new Promise((resolvePromise, reject) => {
      server.closeAllConnections()
      server.close((err) => (err ? reject(err) : resolvePromise()))
    })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Parse an OAuth token-endpoint body as JSON or `application/x-www-form-urlencoded`. */
function parseBody(raw: string, contentType: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (contentType?.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsed)) result[key] = String(value)
    } catch {
      // fall through to an empty result on malformed JSON
    }
    return result
  }
  for (const [key, value] of new URLSearchParams(raw)) result[key] = value
  return result
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// ---------------------------------------------------------------------------
// Mock OAuth issuer
// ---------------------------------------------------------------------------

export async function startMockOAuthIssuer(options: MockOAuthIssuerOptions = {}): Promise<MockServer> {
  const audience = options.audience ?? 'comfy-cloud'
  const expiresInSeconds = options.expiresInSeconds ?? 3600

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const kid = 'mock-oauth-key-1'
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] }

  // authorization code -> the PKCE challenge captured at /oauth/authorize
  const pendingCodes = new Map<string, { codeChallenge: string; codeChallengeMethod: string }>()

  let issuerUrl = options.issuer ?? ''

  function mintAccessToken(): string {
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT', kid }
    const payload = {
      ...DEFAULT_CLAIMS,
      iss: issuerUrl,
      aud: audience,
      iat: now,
      exp: now + expiresInSeconds,
      ...options.extraClaims,
    }
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
    return `${signingInput}.${base64url(signature)}`
  }

  function tokenResponse(): Record<string, unknown> {
    return {
      access_token: mintAccessToken(),
      refresh_token: `mock-refresh-${randomUUID()}`,
      token_type: 'Bearer',
      expires_in: expiresInSeconds,
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri')
      if (!redirectUri) {
        sendJson(res, 400, { error: 'invalid_request', error_description: 'redirect_uri is required' })
        return
      }
      const code = `mock-code-${randomUUID()}`
      pendingCodes.set(code, {
        codeChallenge: url.searchParams.get('code_challenge') ?? '',
        codeChallengeMethod: url.searchParams.get('code_challenge_method') ?? 'plain',
      })
      const location = new URL(redirectUri)
      location.searchParams.set('code', code)
      const state = url.searchParams.get('state')
      if (state !== null) location.searchParams.set('state', state)
      res.writeHead(302, { location: location.toString() })
      res.end()
      return
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const body = parseBody(await readBody(req), req.headers['content-type'])

      if (body.grant_type === 'refresh_token') {
        sendJson(res, 200, tokenResponse())
        return
      }

      const code = body.code
      const stored = code ? pendingCodes.get(code) : undefined
      if (!code || !stored) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'unknown or expired authorization code' })
        return
      }

      const verifier = body.code_verifier ?? ''
      const derivedChallenge =
        stored.codeChallengeMethod === 'S256'
          ? createHash('sha256').update(verifier).digest('base64url')
          : verifier
      if (!verifier || derivedChallenge !== stored.codeChallenge) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'code_verifier does not match code_challenge' })
        return
      }

      pendingCodes.delete(code)
      sendJson(res, 200, tokenResponse())
      return
    }

    if (req.method === 'GET' && (url.pathname === '/.well-known/jwks.json' || url.pathname === '/oauth/jwks')) {
      sendJson(res, 200, jwks)
      return
    }

    sendJson(res, 404, { error: 'not_found', error_description: `no route for ${req.method} ${url.pathname}` })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: 'server_error', error_description: String(err) })
    })
  })

  const baseUrl = await listen(server)
  if (!issuerUrl) issuerUrl = baseUrl
  return { baseUrl, stop: makeStop(server) }
}

// ---------------------------------------------------------------------------
// Mock ComfyBuilder API
// ---------------------------------------------------------------------------

const PIPELINES: Pipeline[] = [
  {
    id: 'pipe-success',
    org_id: 'ws-test',
    name: 'Succeeded Pipeline',
    description: 'Pipeline whose latest deployment succeeded',
    revision: 2,
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-05T12:00:00.000Z',
  },
  {
    id: 'pipe-failed',
    org_id: 'ws-test',
    name: 'Failed Pipeline',
    description: 'Pipeline whose deployments have all failed',
    revision: 1,
    created_at: '2026-07-02T10:00:00.000Z',
    updated_at: '2026-07-03T10:00:00.000Z',
  },
]

// Build steps mirror the real backend's BuildStep IDs + status enum.
const BUILD_STEP_IDS = ['resolve', 'install_nodes', 'fetch_models', 'package', 'test'] as const

interface MockBuildStep {
  id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  started_at: string | null
  finished_at: string | null
}

function succeededSteps(at: string): MockBuildStep[] {
  return BUILD_STEP_IDS.map((id) => ({ id, status: 'succeeded', started_at: at, finished_at: at }))
}

function stepsFailingAt(at: string, failId: (typeof BUILD_STEP_IDS)[number]): MockBuildStep[] {
  const failIndex = BUILD_STEP_IDS.indexOf(failId)
  return BUILD_STEP_IDS.map((id, index) => ({
    id,
    status: index < failIndex ? 'succeeded' : index === failIndex ? 'failed' : 'skipped',
    started_at: index <= failIndex ? at : null,
    finished_at: index <= failIndex ? at : null,
  }))
}

function hasBearer(req: IncomingMessage): boolean {
  const auth = req.headers['authorization']
  return typeof auth === 'string' && /^Bearer\s+.+/i.test(auth)
}

export async function startMockBuilderApi(options: MockBuilderApiOptions = {}): Promise<MockServer> {
  const artifactPath = options.artifactPath ?? MOCK_ARTIFACT_PATH
  const requireAuth = options.requireAuth ?? true

  await ensureMockArtifact(artifactPath)
  const artifactBytes = readFileSync(artifactPath)
  const artifactSize = artifactBytes.byteLength
  const artifactChecksum = `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}`

  // 'mock-token-123' is pre-seeded so the download route also works standalone.
  const validDownloadTokens = new Set<string>(['mock-token-123'])

  function artifactFor(pipelineId: string, buildId: string, version: string): NonNullable<Deployment['artifact']> {
    const filename = `${version}.tar.gz`
    return {
      artifact_id: `builds/${buildId}/linux-nvidia-targz/${filename}`,
      filename,
      download_url: `/api/v1/pipelines/${pipelineId}/deployments/${buildId}/artifact`,
      checksum: artifactChecksum,
      size_bytes: artifactSize,
    }
  }

  function deploymentsFor(pipelineId: string): Deployment[] {
    if (pipelineId === 'pipe-success') {
      return [
        {
          id: 'dep-success-1',
          pipeline_id: 'pipe-success',
          pipeline_revision: 2,
          version: '1.0.0',
          status: 'succeeded',
          steps: succeededSteps('2026-07-05T12:00:00.000Z'),
          created_at: '2026-07-05T11:59:00.000Z',
          started_at: '2026-07-05T11:59:30.000Z',
          finished_at: '2026-07-05T12:00:00.000Z',
          attempt: 1,
          artifact: artifactFor('pipe-success', 'dep-success-1', '1.0.0'),
          error_code: null,
          error_message: null,
        },
        {
          id: 'dep-success-0',
          pipeline_id: 'pipe-success',
          pipeline_revision: 1,
          version: '0.9.0',
          status: 'failed',
          steps: stepsFailingAt('2026-07-04T09:00:00.000Z', 'test'),
          created_at: '2026-07-04T08:58:00.000Z',
          started_at: '2026-07-04T08:59:00.000Z',
          finished_at: '2026-07-04T09:00:00.000Z',
          attempt: 1,
          artifact: null,
          error_code: 'BUILD_FAILED',
          error_message: 'earlier build failed',
        },
      ]
    }
    if (pipelineId === 'pipe-failed') {
      return [
        {
          id: 'dep-failed-1',
          pipeline_id: 'pipe-failed',
          pipeline_revision: 1,
          version: '0.1.0',
          status: 'failed',
          steps: stepsFailingAt('2026-07-03T08:00:00.000Z', 'package'),
          created_at: '2026-07-03T07:58:00.000Z',
          started_at: '2026-07-03T07:59:00.000Z',
          finished_at: '2026-07-03T08:00:00.000Z',
          attempt: 1,
          artifact: null,
          error_code: 'BUILD_FAILED',
          error_message: 'compilation error',
        },
        {
          id: 'dep-failed-2',
          pipeline_id: 'pipe-failed',
          pipeline_revision: 1,
          version: '0.2.0',
          status: 'failed',
          steps: stepsFailingAt('2026-07-03T10:00:00.000Z', 'install_nodes'),
          created_at: '2026-07-03T09:58:00.000Z',
          started_at: '2026-07-03T09:59:00.000Z',
          finished_at: '2026-07-03T10:00:00.000Z',
          attempt: 1,
          artifact: null,
          error_code: 'BUILD_TIMEOUT',
          error_message: 'build timed out',
        },
      ]
    }
    return []
  }

  function streamArtifact(res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(artifactSize),
      'content-disposition': 'attachment; filename="mock-artifact.tar.gz"',
    })
    createReadStream(artifactPath).pipe(res)
  }

  function unauthorized(res: ServerResponse): void {
    sendJson(res, 401, { code: 'unauthorized', message: 'authentication required' })
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const segments = url.pathname.split('/').filter(Boolean)

    // Token-authenticated download (no Bearer required — this is the pre-signed URL).
    if (
      req.method === 'GET' &&
      segments.length === 8 &&
      segments[6] === 'artifact' &&
      segments[7] === 'download'
    ) {
      const token = url.searchParams.get('token')
      if (!token || !validDownloadTokens.has(token)) {
        unauthorized(res)
        return
      }
      streamArtifact(res)
      return
    }

    // Every other /api/v1 route requires a Bearer token.
    if (requireAuth && !hasBearer(req)) {
      unauthorized(res)
      return
    }

    if (req.method === 'GET' && segments.length === 3 && segments[2] === 'pipelines') {
      sendJson(res, 200, PIPELINES)
      return
    }

    if (
      req.method === 'GET' &&
      segments.length === 5 &&
      segments[2] === 'pipelines' &&
      segments[4] === 'deployments'
    ) {
      sendJson(res, 200, deploymentsFor(segments[3] ?? ''))
      return
    }

    if (req.method === 'GET' && segments.length === 7 && segments[6] === 'artifact') {
      streamArtifact(res)
      return
    }

    if (
      req.method === 'POST' &&
      segments.length === 8 &&
      segments[6] === 'artifact' &&
      segments[7] === 'download-token'
    ) {
      const token = 'mock-token-123'
      validDownloadTokens.add(token)
      sendJson(res, 200, { token, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
      return
    }

    sendJson(res, 404, { code: 'not_found', message: `no route for ${req.method} ${url.pathname}` })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      sendJson(res, 500, { code: 'internal_error', message: String(err) })
    })
  })

  const baseUrl = await listen(server)
  return { baseUrl, stop: makeStop(server) }
}

// ---------------------------------------------------------------------------
// Fixture artifact
// ---------------------------------------------------------------------------

/**
 * Build the fixture artifact tarball at `destPath`, containing:
 *   - `standalone-env/bin/python3` (empty)
 *   - `ComfyUI/main.py` (empty)
 *   - `manifest.json`
 * Written with a fixed mtime + portable headers for reproducibility.
 */
export async function createMockArtifact(destPath: string = MOCK_ARTIFACT_PATH): Promise<string> {
  const staging = mkdtempSync(join(tmpdir(), 'mock-artifact-'))
  try {
    mkdirSync(join(staging, 'standalone-env', 'bin'), { recursive: true })
    writeFileSync(join(staging, 'standalone-env', 'bin', 'python3'), '')
    mkdirSync(join(staging, 'ComfyUI'), { recursive: true })
    writeFileSync(join(staging, 'ComfyUI', 'main.py'), '')

    const manifest = {
      id: 'mock-artifact',
      version: '1.0.0',
      comfyui_ref: 'master',
      comfyui_commit: '0000000000000000000000000000000000000000',
      python_version: '3.12.7',
      torch_version: '2.5.1',
      build_date: '2026-07-05T00:00:00.000Z',
      files: ['mock-artifact.tar.gz'],
      matrix_target: 'linux-nvidia-targz',
      plan_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    mkdirSync(dirname(destPath), { recursive: true })
    await tarCreate(
      { gzip: true, file: destPath, cwd: staging, portable: true, mtime: new Date('2026-01-01T00:00:00.000Z') },
      ['standalone-env', 'ComfyUI', 'manifest.json'],
    )
    return destPath
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Generate the fixture artifact if it does not already exist. */
export async function ensureMockArtifact(destPath: string = MOCK_ARTIFACT_PATH): Promise<string> {
  if (!existsSync(destPath)) {
    await createMockArtifact(destPath)
  }
  return destPath
}
