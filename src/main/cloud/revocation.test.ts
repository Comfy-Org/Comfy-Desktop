// @vitest-environment node
import * as fs from 'fs'
import type * as FsModule from 'fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  return { ...actual, rmSync: vi.fn(actual.rmSync), renameSync: vi.fn(actual.renameSync) }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronState.userData), isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) =>
      Buffer.from(`enc:${Buffer.from(value, 'utf-8').toString('base64')}`, 'utf-8')
    ),
    decryptString: vi.fn((value: Buffer) => {
      const text = value.toString('utf-8')
      if (!text.startsWith('enc:')) throw new Error('not encrypted')
      return Buffer.from(text.slice(4), 'base64').toString('utf-8')
    })
  },
  shell: { openExternal: vi.fn(() => Promise.resolve()) }
}))

import { safeStorage } from 'electron'

import { CLOUD_CONFIG } from './config'
import { Revocations } from './revocation'
import { _resetForTest, addPendingRevocation, loadPendingRevocations } from './tokenStore'
import type { PendingRevocation } from './tokenStore'

interface RevokeRequest {
  url: string
  token: string | null
  clientId: string | null
  redirect: RequestRedirect | undefined
}

const MAX_WAIT_MS = 60 * 60_000

type Reply = () => Response | Promise<Response>

let replies: Reply[]
let replyFor: Record<string, Reply>
let requests: RevokeRequest[]

const ok: Reply = () => new Response(null, { status: 200 })
const offline: Reply = () => Promise.reject(new TypeError('fetch failed'))

function status(code: number, body: unknown = {}): Reply {
  return () => new Response(JSON.stringify(body), { status: code })
}

function revocation(refreshToken: string): PendingRevocation {
  return { issuer: CLOUD_CONFIG.issuer, clientId: CLOUD_CONFIG.clientId, refreshToken }
}

function queuedTokens(): string[] {
  _resetForTest()
  return loadPendingRevocations()
    .pending.map((entry) => entry.refreshToken)
    .sort()
}

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-cloud-revocation-'))
  _resetForTest()
  requests = []
  replies = []
  replyFor = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body))
      requests.push({
        url,
        token: body.get('token'),
        clientId: body.get('client_id'),
        redirect: init.redirect
      })
      return (replyFor[body.get('token') ?? ''] ?? replies.shift() ?? ok)()
    })
  )
})

afterEach(() => {
  vi.useRealTimers()
  _resetForTest()
  fs.rmSync(electronState.userData, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('Revocations', () => {
  it('revokes the token at the Cloud that issued it and forgets it once Cloud confirms', async () => {
    const revocations = new Revocations()

    revocations.add(revocation('refresh-1'))
    await revocations.drain()

    expect(requests).toEqual([
      {
        url: CLOUD_CONFIG.revokeUrl,
        token: 'refresh-1',
        clientId: CLOUD_CONFIG.clientId,
        redirect: 'manual'
      }
    ])
    expect(queuedTokens()).toEqual([])
  })

  it('keeps the token on disk before the first attempt answers', async () => {
    let answer: (response: Response) => void = () => {}
    replies = [() => new Promise<Response>((resolve) => (answer = resolve))]
    const revocations = new Revocations()

    revocations.add(revocation('refresh-1'))
    expect(queuedTokens()).toEqual(['refresh-1'])

    answer(new Response(null, { status: 200 }))
    await revocations.drain()
    expect(queuedTokens()).toEqual([])
  })

  it.each<[string, Reply]>([
    ['offline', offline],
    ['a 500', status(500)],
    ['a 503', status(503)],
    ['a 429', status(429)],
    ['a 404 before Cloud serves the endpoint', status(404)],
    ['a 400 without an OAuth error', status(400, { message: 'bad gateway page' })],
    ['a 400 with a transient OAuth error', status(400, { error: 'temporarily_unavailable' })],
    ['a 202', status(202)],
    ['a redirect', () => new Response(null, { status: 307, headers: { location: 'https://x' } })]
  ])('keeps the token after %s and revokes it once Cloud is reachable', async (_name, failure) => {
    vi.useFakeTimers()
    replies = [failure, ok]
    const revocations = new Revocations()

    revocations.add(revocation('refresh-1'))
    await revocations.drain()
    expect(queuedTokens()).toEqual(['refresh-1'])

    await vi.advanceTimersByTimeAsync(5_000)

    expect(requests.map((request) => request.token)).toEqual(['refresh-1', 'refresh-1'])
    expect(queuedTokens()).toEqual([])
  })

  it('backs off between attempts while Cloud stays unreachable', async () => {
    vi.useFakeTimers()
    replies = [offline, offline, offline]
    const revocations = new Revocations()

    revocations.add(revocation('refresh-1'))
    await revocations.drain()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)

    expect(requests).toHaveLength(3)
  })

  it('keeps one backoff when a drain is started again during a backoff', async () => {
    vi.useFakeTimers()
    replies = [offline, offline, ok]
    const revocations = new Revocations()
    revocations.add(revocation('refresh-1'))
    await revocations.drain()

    await revocations.drain()
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)

    expect(requests).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(requests).toHaveLength(3)
    expect(queuedTokens()).toEqual([])
  })

  it.each<[string, number, string]>([
    ['invalid_client', 400, 'invalid_client'],
    ['invalid_request', 400, 'invalid_request'],
    ['invalid_client on 401', 401, 'invalid_client']
  ])('drops the token when Cloud refuses it with %s', async (_name, code, error) => {
    vi.useFakeTimers()
    replies = [status(code, { error })]
    const revocations = new Revocations()

    revocations.add(revocation('refresh-1'))
    await revocations.drain()
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)

    expect(requests).toHaveLength(1)
    expect(queuedTokens()).toEqual([])
  })

  it('revokes a token queued before a relaunch', async () => {
    vi.useFakeTimers()
    replies = [offline]
    const before = new Revocations()
    before.add(revocation('refresh-1'))
    await before.drain()
    expect(requests).toHaveLength(1)

    _resetForTest()
    const relaunched = new Revocations()
    await relaunched.drain()

    expect(requests.map((request) => request.token)).toEqual(['refresh-1', 'refresh-1'])
    expect(queuedTokens()).toEqual([])
  })

  it('sends every queued token, including one queued while another is in flight', async () => {
    let answer: (response: Response) => void = () => {}
    replies = [() => new Promise<Response>((resolve) => (answer = resolve))]
    const revocations = new Revocations()

    revocations.add(revocation('refresh-1'))
    revocations.add(revocation('refresh-2'))
    answer(new Response(null, { status: 200 }))
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await revocations.drain()

    expect(requests.map((request) => request.token)).toEqual(['refresh-1', 'refresh-2'])
    expect(queuedTokens()).toEqual([])
  })

  it('holds a token queued during a backoff until the backoff ends', async () => {
    vi.useFakeTimers()
    replies = [offline]
    const revocations = new Revocations()
    revocations.add(revocation('refresh-1'))
    await revocations.drain()

    revocations.add(revocation('refresh-2'))
    await vi.advanceTimersByTimeAsync(4_999)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(requests[0]?.token).toBe('refresh-1')
    expect(requests.map((request) => request.token).sort()).toEqual([
      'refresh-1',
      'refresh-1',
      'refresh-2'
    ])
    expect(queuedTokens()).toEqual([])
  })

  it('sends a token queued while another attempt fails, then retries only the failed one', async () => {
    vi.useFakeTimers()
    let fail: (error: Error) => void = () => {}
    replies = [() => new Promise<Response>((_resolve, reject) => (fail = reject))]
    const revocations = new Revocations()
    revocations.add(revocation('refresh-1'))
    revocations.add(revocation('refresh-2'))

    fail(new TypeError('fetch failed'))
    await vi.advanceTimersByTimeAsync(4_999)
    expect(requests.map((request) => request.token)).toEqual(['refresh-1', 'refresh-2'])
    await vi.advanceTimersByTimeAsync(1)

    expect(requests.map((request) => request.token)).toEqual([
      'refresh-1',
      'refresh-2',
      'refresh-1'
    ])
    expect(queuedTokens()).toEqual([])
  })

  it('keeps revoking other tokens while one keeps failing', async () => {
    vi.useFakeTimers()
    addPendingRevocation(revocation('refresh-1'))
    addPendingRevocation(revocation('refresh-2'))
    replyFor = { 'refresh-1': status(500) }
    const revocations = new Revocations()

    await revocations.drain()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(queuedTokens()).toEqual(['refresh-1'])
    expect(requests.filter((request) => request.token === 'refresh-2')).toHaveLength(1)
    expect(requests.filter((request) => request.token === 'refresh-1')).toHaveLength(2)
  })

  it('does not resend a confirmed token whose saved copy cannot be deleted, and deletes it later', async () => {
    vi.useFakeTimers()
    const dir = path.join(electronState.userData, 'comfy-cloud-revocations')
    addPendingRevocation(revocation('refresh-1'))
    const revocations = new Revocations()
    vi.mocked(fs.rmSync).mockImplementation(() => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' })
    })

    try {
      await revocations.drain()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(fs.readdirSync(dir)).toHaveLength(1)
    } finally {
      vi.mocked(fs.rmSync).mockReset()
    }
    await vi.advanceTimersByTimeAsync(10_000)

    expect(requests.map((request) => request.token)).toEqual(['refresh-1'])
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('keeps a token it could not save in memory and leaves no partial file', async () => {
    vi.useFakeTimers()
    replies = [offline]
    vi.mocked(fs.renameSync).mockImplementation(() => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    })
    const revocations = new Revocations()

    try {
      revocations.add(revocation('refresh-1'))
      await revocations.drain()
      expect(fs.readdirSync(path.join(electronState.userData, 'comfy-cloud-revocations'))).toEqual(
        []
      )
      expect(loadPendingRevocations().pending.map((entry) => entry.refreshToken)).toEqual([
        'refresh-1'
      ])
    } finally {
      vi.mocked(fs.renameSync).mockReset()
    }
  })

  it('reads a saved token again later when it could not be read at start', async () => {
    vi.useFakeTimers()
    addPendingRevocation(revocation('refresh-2'))
    _resetForTest()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false)

    const relaunched = new Revocations()
    await relaunched.drain()
    expect(requests).toEqual([])

    await vi.advanceTimersByTimeAsync(5_000)
    expect(requests.map((request) => request.token)).toEqual(['refresh-2'])
    expect(queuedTokens()).toEqual([])
  })

  it('sends each token only to the Cloud that issued it', async () => {
    addPendingRevocation({
      issuer: 'https://other-cloud.example',
      clientId: 'other-client',
      refreshToken: 'refresh-elsewhere'
    })
    addPendingRevocation(revocation('refresh-1'))

    await new Revocations().drain()

    expect(requests.map(({ url, token, clientId }) => ({ url, token, clientId }))).toEqual(
      expect.arrayContaining([
        {
          url: 'https://other-cloud.example/oauth/revoke',
          token: 'refresh-elsewhere',
          clientId: 'other-client'
        },
        { url: CLOUD_CONFIG.revokeUrl, token: 'refresh-1', clientId: CLOUD_CONFIG.clientId }
      ])
    )
    expect(requests).toHaveLength(2)
    expect(queuedTokens()).toEqual([])
  })
})
