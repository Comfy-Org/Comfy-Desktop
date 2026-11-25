import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  request: vi.fn(),
  open: vi.fn(),
  listed: vi.fn(),
  subject: null as string | null,
  workspaceId: null as string | null,
  listWorkspaces: vi.fn(),
  installation: vi.fn(),
  localBuilds: vi.fn(),
  transfer: vi.fn(),
  diskSpace: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent' },
  net: { fetch: mocks.fetch, request: mocks.request }
}))
vi.mock('../apps/openInComfy', () => ({ openCatalogInComfy: mocks.open }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    status: () => ({ signedIn: mocks.subject !== null, workspaceId: mocks.workspaceId }),
    currentSubject: () => mocks.subject,
    listWorkspaces: mocks.listWorkspaces
  })
}))
vi.mock('../lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('./workflows', () => ({ listedWorkflow: mocks.listed }))
vi.mock('../installations', () => ({ get: mocks.installation }))
vi.mock('../apps/localBuild', () => ({ usableLocalBuilds: mocks.localBuilds }))
vi.mock('../settings', () => ({ get: () => undefined, defaults: { modelsDirs: [] } }))
vi.mock('../lib/comfyDownloadManager', () => ({ startManagedModelJob: mocks.transfer }))
vi.mock('../lib/disk', () => ({ getDiskSpace: mocks.diskSpace }))
vi.mock('../lib/pythonEnv', () => ({ getActiveVenvDir: () => null }))
vi.mock('../sources/standalone/envPaths', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findSitePackages: () => null
}))
vi.mock('../sources/standalone/curatedTemplates', () => ({
  RAW_TEMPLATES_BASE: '',
  TEMPLATE_INPUT_BASE: ''
}))
vi.mock('../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import { _forgetEditorGraphsForTest } from './editorGraph'
import { cancelCatalogWorkflowDownload, launchCatalogWorkflow } from './launchWorkflow'
import { _forgetModelSizesForTest } from './workflowNeeds'
import { missingModelFiles, resolveDownloadContextById } from '../lib/modelDownloadPaths'
import {
  forgetTemplateDownload,
  hasActiveTemplateDownloads
} from '../sources/standalone/templateDownloadTask'

const sent: unknown[] = []
const PAGE = {
  isDestroyed: () => false,
  send: (_channel: string, progress: unknown) => sent.push(progress)
} as unknown as WebContents
const URL = 'https://cloud.comfy.org/api/v1/catalog/media/graph/version'
const PROMPT = { '1': { class_type: 'SaveImage', inputs: {} } }
const MODEL_URL = 'https://huggingface.co/Comfy-Org/repo/resolve/main/model.safetensors'
const MODEL = { filename: 'model.safetensors', directory: 'checkpoints' }
const MODEL_BYTES = Buffer.alloc(2048, 7)
const GRAPH = {
  nodes: [
    {
      id: 1,
      type: 'CheckpointLoaderSimple',
      widgets_values: [MODEL.filename],
      properties: {
        models: [{ name: MODEL.filename, url: MODEL_URL, directory: MODEL.directory }]
      }
    },
    {
      id: 2,
      type: 'UNETLoader',
      widgets_values: ['z_image_turbo_bf16.safetensors', 'default'],
      properties: {
        models: [
          {
            name: 'z_image_bf16.safetensors',
            url: 'https://huggingface.co/Comfy-Org/z_image/resolve/main/z_image_bf16.safetensors',
            directory: 'diffusion_models'
          }
        ]
      }
    },
    { id: 3, type: 'SaveImage' }
  ],
  links: []
}
const LOCAL = { where: 'local', build: 'inst-local' }

let buildDir = ''

type Transfer = 'completes' | 'fails' | 'hangs'

interface TransferRequest {
  url: string
  filename: string
  directory: string
  installationId: string
  onProgress: (received: number, total: number) => void
}

const transferStopped = vi.fn()

function transfersModels(how: Transfer): void {
  mocks.transfer.mockImplementation(async (job: TransferRequest) => {
    const context = await resolveDownloadContextById(job.installationId)
    const savePath = path.join(context!.downloadBaseDir, job.directory, job.filename)
    const handle = { id: job.url, url: job.url, savePath, release: transferStopped }
    if (how === 'hangs') {
      job.onProgress(MODEL_BYTES.length / 4, MODEL_BYTES.length)
      return { ...handle, completion: new Promise(() => {}) }
    }
    if (how === 'fails') {
      return { ...handle, completion: Promise.resolve({ status: 'error', error: 'HTTP 503' }) }
    }
    await fs.promises.mkdir(path.dirname(savePath), { recursive: true })
    await fs.promises.writeFile(savePath, MODEL_BYTES)
    job.onProgress(MODEL_BYTES.length, MODEL_BYTES.length)
    return { ...handle, completion: Promise.resolve({ status: 'completed', savePath }) }
  })
}

function answersModelSizes(): void {
  mocks.request.mockImplementation(() => {
    const request = Object.assign(new EventEmitter(), {
      end: () =>
        queueMicrotask(() =>
          request.emit('response', {
            statusCode: 200,
            headers: { 'content-length': [String(MODEL_BYTES.length)] }
          })
        ),
      abort: vi.fn(),
      followRedirect: vi.fn()
    })
    return request
  })
}

async function buildIsMissing(): Promise<string[]> {
  const missing = await missingModelFiles('inst-local', [{ ...MODEL, url: MODEL_URL }])
  return missing.map(({ filename }) => filename)
}

async function putModelInBuild(): Promise<void> {
  const context = await resolveDownloadContextById('inst-local')
  const savePath = path.join(context!.downloadBaseDir, MODEL.directory, MODEL.filename)
  await fs.promises.mkdir(path.dirname(savePath), { recursive: true })
  await fs.promises.writeFile(savePath, MODEL_BYTES)
}

beforeEach(() => {
  vi.resetAllMocks()
  _forgetEditorGraphsForTest()
  _forgetModelSizesForTest()
  sent.length = 0
  buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-launch-build-'))
  mocks.installation.mockResolvedValue({
    id: 'inst-local',
    installPath: buildDir,
    useSharedModels: false
  })
  mocks.localBuilds.mockResolvedValue([{ id: 'inst-local', version: '0.3.66' }])
  mocks.diskSpace.mockResolvedValue({ free: 1e15, total: 1e15 })
  answersModelSizes()
  transfersModels('completes')
  mocks.subject = null
  mocks.workspaceId = null
  mocks.listWorkspaces.mockResolvedValue([])
  mocks.listed.mockImplementation((id) =>
    id === 'catalog-id'
      ? {
          card: {
            id: 'catalog-id',
            title: 'Example',
            canOpenLocal: true,
            canOpenCloud: true,
            minComfyUIVersion: '0.3.66'
          },
          editorGraphUrl: URL,
          cloudPrompt: PROMPT
        }
      : undefined
  )
  mocks.fetch.mockImplementation(async () => Response.json(GRAPH))
  mocks.open.mockResolvedValue({ opened: true })
})

afterEach(() => {
  forgetTemplateDownload('catalog-workflow:catalog-id:inst-local')
  fs.rmSync(buildDir, { recursive: true, force: true })
})

describe('launching workflows from the published catalog', () => {
  it('imports the catalog’s editable graph in the selected local build', async () => {
    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')).toEqual({
      opened: true
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ credentials: 'omit', redirect: 'error' })
    )
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      { ...LOCAL, name: 'Example', graph: GRAPH, refreshModels: false },
      expect.objectContaining({ workspaceId: 'personal', minComfyUIVersion: '0.3.66' })
    )
  })

  it('does not fetch or launch for an unknown id or invalid target', async () => {
    for (const [id, target] of [
      ['https://example.org', LOCAL],
      ['catalog-id', { where: 'local', build: '../build' }],
      ['catalog-id', { where: 'cloud', build: 'inst-local' }]
    ]) {
      expect(await launchCatalogWorkflow(PAGE, id, target, 'personal')).toEqual({
        opened: false,
        error: 'workflowLaunch.unavailable'
      })
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('falls back to the validated API prompt for Cloud when the graph is unavailable', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }))
    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', { where: 'cloud' }, 'personal')).toEqual(
      {
        opened: true
      }
    )
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      { where: 'cloud', name: 'Example', prompt: PROMPT },
      expect.anything()
    )
  })

  it('honors a newly selected Cloud workspace after confirming membership', async () => {
    mocks.subject = 'account'
    mocks.workspaceId = 'other'
    mocks.listWorkspaces.mockResolvedValue([{ id: 'team' }])

    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', { where: 'cloud' }, 'team')).toEqual({
      opened: true
    })
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      expect.anything(),
      expect.objectContaining({
        workspaceId: 'team'
      })
    )
  })

  it('refuses to open Cloud in a workspace the signed-in account cannot access', async () => {
    mocks.subject = 'account'
    mocks.workspaceId = 'other'

    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', { where: 'cloud' }, 'unknown')).toEqual({
      opened: false,
      error: 'workflowLaunch.openFailed'
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('refuses invalid or oversized local graphs before starting the build', async () => {
    for (const response of [
      Response.json({ nodes: [{ notAType: 'SaveImage' }] }),
      Response.json({ ...GRAPH, padding: 'x'.repeat(1_000_001) })
    ]) {
      mocks.fetch.mockResolvedValue(response)
      expect(await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')).toEqual({
        opened: false,
        error: 'workflowLaunch.openFailed'
      })
    }
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('does not launch after the account changes during graph download', async () => {
    mocks.fetch.mockImplementation(async () => {
      mocks.subject = 'changed-subject'
      return Response.json(GRAPH)
    })
    expect(await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')).toEqual({
      opened: false,
      error: 'workflowLaunch.openFailed'
    })
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('downloads the models a local build is missing into it, reports progress, then opens the graph', async () => {
    expect(await buildIsMissing()).toEqual([MODEL.filename])

    expect(
      await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal', { downloadMissing: true })
    ).toEqual({ opened: true })

    expect(await buildIsMissing()).toEqual([])
    expect(
      mocks.transfer.mock.calls.map(([job]) => (job as TransferRequest).filename),
      'a download the loader does not select is never fetched'
    ).toEqual([MODEL.filename])
    expect(sent.at(-1)).toEqual({
      id: 'catalog-id',
      build: 'inst-local',
      receivedBytes: MODEL_BYTES.length,
      totalBytes: MODEL_BYTES.length
    })
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      { ...LOCAL, name: 'Example', graph: GRAPH, refreshModels: true },
      expect.anything()
    )
    expect(hasActiveTemplateDownloads()).toBe(false)
  })

  it('does not open the graph when the model download fails', async () => {
    transfersModels('fails')

    expect(
      await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal', { downloadMissing: true })
    ).toEqual({ opened: false, error: 'workflowLaunch.downloadFailed' })

    expect(await buildIsMissing()).toEqual([MODEL.filename])
    expect(mocks.open).not.toHaveBeenCalled()
    expect(hasActiveTemplateDownloads()).toBe(false)
    expect(
      sent,
      'the failure is the launch’s answer, not one more progress report a reopened page would pick up'
    ).toHaveLength(1)
  })

  it('stops the transfer when the download is cancelled, and does not open the graph', async () => {
    transfersModels('hangs')
    expect(cancelCatalogWorkflowDownload('catalog-id', 'inst-local')).toBe(false)

    const launching = launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal', {
      downloadMissing: true
    })
    await vi.waitFor(() => expect(mocks.transfer).toHaveBeenCalledOnce())
    expect(hasActiveTemplateDownloads()).toBe(true)

    expect(cancelCatalogWorkflowDownload('catalog-id', 'inst-local')).toBe(true)

    expect(await launching).toEqual({ opened: false, error: 'workflowLaunch.downloadCancelled' })
    expect(
      transferStopped,
      'the partial download is cancelled, not left paused'
    ).toHaveBeenCalledWith('cancel')
    expect(hasActiveTemplateDownloads()).toBe(false)
    expect(await buildIsMissing()).toEqual([MODEL.filename])
    expect(mocks.open).not.toHaveBeenCalled()
    expect(cancelCatalogWorkflowDownload('catalog-id', 'inst-local')).toBe(false)
  })

  it('opens the workflow once when the same launch is asked for again while it is under way', async () => {
    let finishOpening: (result: { opened: true }) => void = () => {}
    mocks.open.mockReturnValue(new Promise((resolve) => (finishOpening = resolve)))

    const first = launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')
    const again = launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalled())
    finishOpening({ opened: true })

    expect(await Promise.all([first, again])).toEqual([{ opened: true }, { opened: true }])
    expect(mocks.open).toHaveBeenCalledOnce()

    mocks.open.mockResolvedValue({ opened: true })
    await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')
    expect(
      mocks.open,
      'a launch asked for after the first one ended opens again'
    ).toHaveBeenCalledTimes(2)
  })

  it('keeps launches into different places apart', async () => {
    mocks.subject = 'user'
    const finishOpening: ((result: { opened: true }) => void)[] = []
    mocks.open.mockImplementation(() => new Promise((resolve) => finishOpening.push(resolve)))

    const local = launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal')
    const cloud = launchCatalogWorkflow(PAGE, 'catalog-id', { where: 'cloud' }, 'personal')
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2))

    for (const finish of finishOpening) finish({ opened: true })
    expect(await Promise.all([local, cloud])).toEqual([{ opened: true }, { opened: true }])
  })

  it('says the disk is full when the models do not fit, before transferring anything', async () => {
    mocks.diskSpace.mockResolvedValue({ free: MODEL_BYTES.length, total: 1e15 })

    expect(
      await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal', { downloadMissing: true })
    ).toEqual({ opened: false, error: 'workflowLaunch.noDiskSpace' })

    expect(mocks.transfer).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('skips the download when the build already has every model', async () => {
    await putModelInBuild()

    expect(
      await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal', { downloadMissing: true })
    ).toEqual({ opened: true })
    expect(mocks.transfer).not.toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({ refreshModels: false }),
      expect.anything()
    )
  })

  it('downloads nothing into a build from another workspace or one below the workflow’s minimum', async () => {
    mocks.installation.mockResolvedValueOnce({
      id: 'inst-local',
      installPath: buildDir,
      workspaceId: 'team-b'
    })
    expect(
      await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal', { downloadMissing: true })
    ).toEqual({ opened: false, error: 'apps.local.openUnknownBuild' })

    mocks.localBuilds.mockResolvedValueOnce([{ id: 'inst-local', version: '0.3.65' }])
    expect(
      await launchCatalogWorkflow(PAGE, 'catalog-id', LOCAL, 'personal', { downloadMissing: true })
    ).toEqual({ opened: false, error: 'workflowLaunch.updateBuild' })

    expect(mocks.transfer).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
