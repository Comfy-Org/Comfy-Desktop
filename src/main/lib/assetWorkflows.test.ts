// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  files: new Map<string, string>(),
  fromPanel: true,
  openEmbeddedWorkflow: vi.fn(),
  cloudAccessToken: vi.fn(),
  resolveCloudContentUrl: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../apps/openInComfy', () => ({ openEmbeddedWorkflow: mocks.openEmbeddedWorkflow }))
vi.mock('../host/registry', () => ({ isPanelSender: () => mocks.fromPanel }))
vi.mock('./i18n', () => ({ t: (key: string) => key }))
vi.mock('./outputFolders', () => ({
  READ_WITHOUT_FOLLOWING: 'r',
  outputFilePath: vi.fn(async (id: string) => mocks.files.get(id) ?? null)
}))
vi.mock('./assets', () => ({
  cloudAccessToken: mocks.cloudAccessToken,
  resolveCloudContentUrl: mocks.resolveCloudContentUrl,
  firstBytes: async (response: Response, limit: number) =>
    new Uint8Array(await response.arrayBuffer()).subarray(0, limit)
}))

import { outputFilePath } from './outputFolders'
import {
  _resetForTest,
  ASSET_WORKFLOW_CHANNELS,
  PART_BYTES,
  registerAssetWorkflowHandlers
} from './assetWorkflows'

const GRAPH = { nodes: [{ id: 1, type: 'SaveImage' }], links: [] }
const SAVED_WORKFLOW = `workflow=${JSON.stringify(GRAPH)}`
const EVENT = { sender: {} }
const LOCAL = 'local'

let folder: string

async function savedFile(id: string, content: string | Buffer): Promise<void> {
  const file = path.join(folder, id)
  await writeFile(file, content)
  mocks.files.set(id, file)
}

function hasWorkflow(source: string, assetId: string): Promise<boolean> {
  return mocks.handlers.get(ASSET_WORKFLOW_CHANNELS.has)!(
    EVENT,
    source,
    assetId
  ) as Promise<boolean>
}

function openWorkflow(source: string, assetId: string, name: string, build?: string) {
  return mocks.handlers.get(ASSET_WORKFLOW_CHANNELS.open)!(EVENT, source, assetId, name, build)
}

function partial(body: string, total: number): Response {
  return new Response(body, {
    status: 206,
    headers: { 'content-range': `bytes 0-${PART_BYTES - 1}/${total}` }
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  _resetForTest()
  mocks.files.clear()
  mocks.fromPanel = true
  mocks.openEmbeddedWorkflow.mockResolvedValue({ opened: true })
  registerAssetWorkflowHandlers()
  folder = await mkdtemp(path.join(tmpdir(), 'asset-workflows-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(folder, { recursive: true, force: true })
})

describe('a file on this computer', () => {
  it('opens its workflow in the build it is asked for, named after the file', async () => {
    await savedFile('fox.flac', `fLaC\u0000${SAVED_WORKFLOW}\u0000`)

    expect(await hasWorkflow(LOCAL, 'fox.flac')).toBe(true)
    expect(await openWorkflow(LOCAL, 'fox.flac', 'fox.flac', 'inst-lab')).toEqual({ opened: true })

    expect(mocks.openEmbeddedWorkflow).toHaveBeenCalledExactlyOnceWith(
      { where: 'local', build: 'inst-lab' },
      { format: 'graph', data: GRAPH },
      'fox'
    )
  })

  it('finds a workflow that runs across the middle of a file a little over 4 MB', async () => {
    const workflow = Buffer.from(SAVED_WORKFLOW)
    const padding = Buffer.alloc(PART_BYTES - 10, 0)
    await savedFile('clip.mp4', Buffer.concat([padding, workflow, Buffer.alloc(1000, 0)]))

    expect(await hasWorkflow(LOCAL, 'clip.mp4')).toBe(true)
  })

  it('finds a workflow saved at the end of a large video', async () => {
    const padding = Buffer.alloc(PART_BYTES * 2, 0)
    await savedFile('clip.mp4', Buffer.concat([padding, Buffer.from(`moov${SAVED_WORKFLOW}`)]))

    expect(await hasWorkflow(LOCAL, 'clip.mp4')).toBe(true)
  })

  it('has no Open workflow when the file holds no workflow', async () => {
    await savedFile('plain.png', 'not a picture with a workflow')

    expect(await hasWorkflow(LOCAL, 'plain.png')).toBe(false)
    expect(await openWorkflow(LOCAL, 'plain.png', 'plain.png', 'inst-lab')).toEqual({
      opened: false,
      error: 'apps.local.openNotWorkflow'
    })
    expect(mocks.openEmbeddedWorkflow).not.toHaveBeenCalled()
  })

  it('needs a build to open in and reads nothing without one', async () => {
    await savedFile('fox.flac', SAVED_WORKFLOW)

    expect(await openWorkflow(LOCAL, 'fox.flac', 'fox.flac')).toEqual({
      opened: false,
      error: 'apps.local.openUnknownBuild'
    })
    expect(outputFilePath).not.toHaveBeenCalled()
  })

  it('reads nothing for a file outside the output folders, and says the read failed', async () => {
    expect(await hasWorkflow(LOCAL, '/etc/passwd')).toBeNull()
  })
})

describe('a file in Comfy Cloud', () => {
  it('reads the start and the end of the file and opens its workflow in Comfy Cloud', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/clip')
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const range = (init.headers as Record<string, string>)['Range']
      return range === `bytes=-${PART_BYTES}`
        ? partial(`moov${SAVED_WORKFLOW}`, PART_BYTES * 3)
        : partial('ftypisom', PART_BYTES * 3)
    })
    vi.stubGlobal('fetch', fetch)

    expect(await openWorkflow('inst-cloud', 'asset-1', 'clip.mp4')).toEqual({ opened: true })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mocks.openEmbeddedWorkflow).toHaveBeenCalledExactlyOnceWith(
      { where: 'cloud' },
      { format: 'graph', data: GRAPH },
      'clip'
    )
  })

  it('reads only the start of a Cloud file when the server sends the whole file', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/fox')
    const fetch = vi.fn(async () => new Response(`fLaC${SAVED_WORKFLOW}`, { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    expect(await hasWorkflow('inst-cloud', 'asset-2')).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('reads the file again next time when the end of it could not be read', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/clip')
    let tailFails = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const range = (init.headers as Record<string, string>)['Range']
        if (range !== `bytes=-${PART_BYTES}`) return partial('ftypisom', PART_BYTES * 3)
        return tailFails
          ? new Response('', { status: 503 })
          : partial(SAVED_WORKFLOW, PART_BYTES * 3)
      })
    )

    expect(await hasWorkflow('inst-cloud', 'asset-3')).toBeNull()
    tailFails = false
    expect(await hasWorkflow('inst-cloud', 'asset-3')).toBe(true)
  })

  it('never answers from what another Comfy Cloud sign-in read', async () => {
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/fox')
    const fetch = vi.fn(async () => new Response(`fLaC${SAVED_WORKFLOW}`, { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    mocks.cloudAccessToken.mockResolvedValue('first-account')
    expect(await hasWorkflow('inst-cloud', 'asset-4')).toBe(true)
    expect(await hasWorkflow('inst-cloud', 'asset-4')).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()

    mocks.cloudAccessToken.mockResolvedValue(null)
    expect(await hasWorkflow('inst-cloud', 'asset-4')).toBeNull()
    mocks.cloudAccessToken.mockResolvedValue('second-account')
    expect(await hasWorkflow('inst-cloud', 'asset-4')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reads a Cloud file a little over 4 MB in two pieces that join, so a workflow across the 4 MB mark is found', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/clip')
    const whole = `${'\u0000'.repeat(PART_BYTES - 10)}${SAVED_WORKFLOW}`
    const head = whole.slice(0, PART_BYTES)
    const rest = whole.slice(PART_BYTES)
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const range = (init.headers as Record<string, string>)['Range']
      return range === `bytes=${PART_BYTES}-`
        ? partial(rest, whole.length)
        : partial(head, whole.length)
    })
    vi.stubGlobal('fetch', fetch)

    expect(await hasWorkflow('inst-cloud', 'asset-6')).toBe(true)
    expect(
      fetch.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['Range'])
    ).toEqual([`bytes=0-${PART_BYTES - 1}`, `bytes=${PART_BYTES}-`])
  })

  it('uses the whole file when the server sends it for the rest of a file a little over 4 MB', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/clip')
    const whole = `${'\u0000'.repeat(PART_BYTES - 10)}${SAVED_WORKFLOW}`
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const range = (init.headers as Record<string, string>)['Range']
        return range === `bytes=${PART_BYTES}-`
          ? new Response(whole, { status: 200 })
          : partial(whole.slice(0, PART_BYTES), whole.length)
      })
    )

    expect(await hasWorkflow('inst-cloud', 'asset-8')).toBe(true)
  })

  it('reads the end of a large Cloud animated PNG, where SaveAnimatedPNG saves its workflow', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/big.png')
    const pngStart = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const range = (init.headers as Record<string, string>)['Range']
      const body = range === `bytes=-${PART_BYTES}` ? `comf\u0000${SAVED_WORKFLOW}` : pngStart
      return new Response(body, {
        status: 206,
        headers: { 'content-range': `bytes 0-${PART_BYTES - 1}/${PART_BYTES * 3}` }
      })
    })
    vi.stubGlobal('fetch', fetch)

    expect(await hasWorkflow('inst-cloud', 'asset-5')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('skips the end of a large Cloud PNG when its start already holds the workflow', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/still.png')
    const textChunk = (key: string, text: string): Buffer => {
      const data = Buffer.concat([Buffer.from(key), Buffer.from([0]), Buffer.from(text)])
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      return Buffer.concat([length, Buffer.from('tEXt'), data, Buffer.alloc(4)])
    }
    const head = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      textChunk('workflow', JSON.stringify(GRAPH))
    ])
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(head), {
          status: 206,
          headers: { 'content-range': `bytes 0-${PART_BYTES - 1}/${PART_BYTES * 3}` }
        })
    )
    vi.stubGlobal('fetch', fetch)

    expect(await hasWorkflow('inst-cloud', 'asset-9')).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('finds the workflow at the end of a large animated PNG on this computer', async () => {
    const pngStart = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const frames = Buffer.alloc(PART_BYTES * 2, 0)
    await savedFile(
      'loop.png',
      Buffer.concat([pngStart, frames, Buffer.from(`comf\u0000${SAVED_WORKFLOW}`)])
    )

    expect(await hasWorkflow(LOCAL, 'loop.png')).toBe(true)
  })

  it('says the read failed, not that there is no workflow, when Comfy Cloud does not answer', async () => {
    mocks.cloudAccessToken.mockResolvedValue('token')
    mocks.resolveCloudContentUrl.mockResolvedValue('https://storage.googleapis.com/fox')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    )

    expect(await hasWorkflow('inst-cloud', 'asset-7')).toBeNull()
    expect(await openWorkflow('inst-cloud', 'asset-7', 'fox.png')).toEqual({
      opened: false,
      error: 'apps.local.openUnreadable'
    })
    expect(mocks.openEmbeddedWorkflow).not.toHaveBeenCalled()
  })

  it('says the read failed when Desktop is not signed in to Comfy Cloud', async () => {
    mocks.cloudAccessToken.mockResolvedValue(null)

    expect(await hasWorkflow('inst-cloud', 'asset-1')).toBeNull()
  })
})

describe('who can ask', () => {
  it('only the Desktop panel can ask about or open a workflow', async () => {
    mocks.fromPanel = false
    await savedFile('fox.flac', SAVED_WORKFLOW)

    expect(await hasWorkflow(LOCAL, 'fox.flac')).toBe(false)
    expect(await openWorkflow(LOCAL, 'fox.flac', 'fox.flac', 'inst-lab')).toEqual({
      opened: false,
      error: 'apps.local.openNotTaken'
    })
    expect(outputFilePath).not.toHaveBeenCalled()
  })
})
