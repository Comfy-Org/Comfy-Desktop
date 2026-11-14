import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  FAKE_COMFY_API_SERVER,
  FAKE_OUTPUT_TEXT,
  SOMEONE_ELSES_RUN
} from './__fixtures__/fakeComfyApi'
import type { FakeComfySeen } from './__fixtures__/fakeComfyApi'

const mocks = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  pages: [] as { send: (channel: string, event: unknown) => void }[]
}))

vi.mock('../host/registry', () => ({ getEntryByInstallationId: () => undefined }))
vi.mock('../installations', () => ({
  list: async () => [
    {
      id: 'studio',
      name: 'Studio',
      sourceId: 'standalone',
      installPath: '/builds/studio',
      status: 'installed',
      version: 'v0.42.1'
    }
  ],
  get: async () => null
}))
vi.mock('../lib/comfyDownloadManager', () => ({ startManagedModelJob: vi.fn() }))
vi.mock('../lib/comfyProcessRecord', () => ({ probeQueue: async () => null }))
vi.mock('../lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../lib/ipc/sessionActions/launch', () => ({ handleLaunch: vi.fn() }))
vi.mock('../lib/ipc/shared', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    _hasActiveLaunch: () => false,
    _operationAborts: new Map(),
    _runningSessions: mocks.sessions,
    sessionLifecycleEvents: new EventEmitter(),
    sourceMap: { standalone: { category: 'local' } },
    stopRunning: vi.fn()
  }
})
vi.mock('../lib/models', () => ({ resolveComfyDir: (installPath: string) => installPath }))
vi.mock('../lib/process', () => ({ COMFY_BOOT_TIMEOUT_MS: 300_000 }))
vi.mock('./appsPages', () => ({ liveAppsPages: () => mocks.pages }))

import * as local from './localComfy'

const WANT = { minVersion: '0.41.0' }
const PAGE = {} as WebContents
const localState = (want: unknown) => local.localState(PAGE, want)
const localFetch = (raw: unknown) => local.localFetch(PAGE, raw)

let comfy: ChildProcess
let scriptDir = ''
let port = 0

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address() as AddressInfo
      probe.close(() => resolve(free))
    })
  })
}

function textOf(answer: { body: Uint8Array }): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(answer.body)) as Record<string, unknown>
}

async function whatComfySaw(): Promise<FakeComfySeen> {
  return (await (await fetch(`http://127.0.0.1:${port}/e2e/seen`)).json()) as FakeComfySeen
}

beforeAll(async () => {
  port = await freePort()
  scriptDir = mkdtempSync(path.join(os.tmpdir(), 'comfy-apps-local-'))
  const script = path.join(scriptDir, 'fake-comfy.cjs')
  writeFileSync(script, FAKE_COMFY_API_SERVER)
  comfy = spawn(process.execPath, [script, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'inherit']
  })
  await new Promise<void>((resolve) => {
    comfy.stdout?.on('data', (line: Buffer) => {
      if (String(line).includes('To see the GUI')) resolve()
    })
  })
  mocks.sessions.set('studio', { port })
})

afterAll(() => {
  local._resetForTest()
  comfy?.kill()
  if (scriptDir) rmSync(scriptDir, { recursive: true, force: true })
})

describe('a run on a ComfyUI that really answers and really talks over its socket', () => {
  it("goes from a picture to its result, with ComfyUI's updates reaching the page on the way", async () => {
    const updates: string[] = []
    mocks.pages = [{ send: (_channel, event) => updates.push((event as { type: string }).type) }]

    const state = await localState(WANT)
    const uploaded = textOf(
      await localFetch({
        method: 'POST',
        path: '/upload/image',
        body: new Uint8Array([1, 2, 3, 4]),
        fileName: 'photo.png'
      })
    )
    const started = textOf(
      await localFetch({
        method: 'POST',
        path: '/prompt',
        body: JSON.stringify({
          prompt: { load: { class_type: 'LoadImage', inputs: { image: 'comfy-apps/photo.png' } } },
          client_id: 'the-page',
          extra_data: { comfy_app: { name: 'Remove Background' } }
        })
      })
    )
    const run = String(started['prompt_id'])
    await vi.waitFor(() => expect(updates).toContain('execution_success'), { timeout: 10_000 })
    const history = textOf(await localFetch({ path: `/history/${run}` }))
    const entry = history[run] as { outputs: { save: { images: Record<string, string>[] } } }
    const file = entry.outputs.save.images[0] ?? {}
    const result = await localFetch({ path: `/view?${new URLSearchParams(file)}` })

    expect(state).toMatchObject({ state: 'running', name: 'Studio', version: '0.42.1' })
    expect(uploaded).toEqual({ name: 'photo.png', subfolder: 'comfy-apps', type: 'input' })
    expect(updates).toEqual(['execution_start', 'executing', 'execution_success'])
    expect(new TextDecoder().decode(result.body)).toBe(FAKE_OUTPUT_TEXT)
    expect(result.contentType).toBe('image/png')

    const seen = await whatComfySaw()
    expect(seen.sockets).toEqual([state.clientId])
    expect(seen.prompts).toEqual([
      { id: run, clientId: state.clientId, app: 'Remove Background', nodes: ['load'] }
    ])
    expect(seen.uploads).toEqual([
      { name: 'photo.png', subfolder: 'comfy-apps', overwrite: false, bytes: expect.any(Number) }
    ])
  })

  it('shows the queue without the other run in it, and can stop only its own run', async () => {
    const queue = textOf(await localFetch({ path: '/queue' }))
    const own = (await whatComfySaw()).prompts[0]?.id ?? ''
    const stopOf = (promptId: string) =>
      localFetch({
        method: 'POST',
        path: '/interrupt',
        body: JSON.stringify({ prompt_id: promptId })
      })

    expect(queue).toEqual({ running: [{ n: 1, id: null, app: null, seconds: null }], pending: [] })
    expect((await stopOf(SOMEONE_ELSES_RUN)).status).toBe(403)
    expect((await stopOf(own)).status).toBe(200)
    expect((await whatComfySaw()).interrupted).toEqual([own])
  })

  it('never lets a request outside the list reach ComfyUI', async () => {
    const refused = await localFetch({ path: '/system_stats' })

    expect(refused.status).toBe(403)
    expect((await whatComfySaw()).asked).not.toContain('GET /system_stats')
  })
})
