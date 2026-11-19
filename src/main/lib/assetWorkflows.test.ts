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
    expect(outputFilePath).toHaveBeenCalledOnce()
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

  it('reads nothing for a file outside the output folders', async () => {
    expect(await hasWorkflow(LOCAL, '/etc/passwd')).toBe(false)
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

  it('has no Open workflow when Desktop is not signed in to Comfy Cloud', async () => {
    mocks.cloudAccessToken.mockResolvedValue(null)

    expect(await hasWorkflow('inst-cloud', 'asset-1')).toBe(false)
  })
})

describe('who can ask', () => {
  it('only the Desktop panel can ask about or open a workflow', async () => {
    mocks.fromPanel = false
    await savedFile('fox.flac', SAVED_WORKFLOW)

    expect(await hasWorkflow(LOCAL, 'fox.flac')).toBe(false)
    expect(await openWorkflow(LOCAL, 'fox.flac', 'fox.flac', 'inst-lab')).toEqual({
      opened: false,
      error: 'apps.local.openNotWorkflow'
    })
    expect(outputFilePath).not.toHaveBeenCalled()
  })
})
