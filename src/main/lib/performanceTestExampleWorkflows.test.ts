import { EventEmitter } from 'node:events'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fetch', () => ({ fetchJSON: vi.fn() }))
vi.mock('./disk', () => ({ getDiskSpace: vi.fn() }))
vi.mock('./modelDownloadPaths', () => ({
  getModelsBaseDir: () => 'C:\\shared-models',
  resolveDownloadContextById: vi.fn(),
  resolveModelsPresence: vi.fn()
}))
vi.mock('../sources/standalone/templateDownloadTask', () => ({
  forgetTemplateDownload: vi.fn(),
  startTemplateDownloadTask: vi.fn(),
  subscribeTemplateDownload: vi.fn()
}))

import benchmarkTemplates from '../../../assets/benchmark-templates.json'
import { getDiskSpace } from './disk'
import { fetchJSON } from './fetch'
import { resolveDownloadContextById, resolveModelsPresence } from './modelDownloadPaths'
import {
  forgetTemplateDownload,
  startTemplateDownloadTask,
  subscribeTemplateDownload
} from '../sources/standalone/templateDownloadTask'
import type { TemplateDownloadSummary } from '../sources/standalone/templateDownloadCore'
import type { InstallationRecord } from '../installations'
import {
  cancelExampleModelDownload,
  ExampleWorkflowFetchError,
  type ExampleDownloadPage,
  getPerformanceTestExampleCatalog,
  loadPerformanceTestExampleArtifacts,
  startExampleModelDownload
} from './performanceTestExampleWorkflows'

const REPO = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main'
const INDEX_URL = `${REPO}/templates/index.json`
const bundledIds = benchmarkTemplates.templates.map(({ id }) => id)
/** Any bundled image example; the list content changes with upstream `benchmarks/`. */
const SAMPLE_ID = benchmarkTemplates.templates.find(({ modality }) => modality === 'image')!.id
const liveIndex = [
  {
    title: 'Image',
    type: 'image',
    templates: [
      {
        name: SAMPLE_ID,
        title: 'Sample Live: Text to Image',
        description: 'Live description.',
        size: 123,
        mediaSubtype: 'webp',
        tags: ['Image', 'Text to Image']
      }
    ]
  }
]
const editorWorkflow = { nodes: [] }
const apiWorkflow = { '1': { class_type: 'KSampler', inputs: {} } }

function serveRepo(): void {
  vi.mocked(fetchJSON).mockImplementation(async (url) => {
    if (url === INDEX_URL) return liveIndex
    if (url === `${REPO}/templates/${SAMPLE_ID}.json`) return editorWorkflow
    if (url === `${REPO}/benchmarks/${SAMPLE_ID}.json`) return apiWorkflow
    throw new Error(`HTTP 404 ${url}`)
  })
}

describe('performance test example workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers every bundled benchmark with its cover, download badge and disk space', async () => {
    serveRepo()
    vi.mocked(resolveDownloadContextById).mockResolvedValue({
      downloadBaseDir: 'D:\\models'
    } as Awaited<ReturnType<typeof resolveDownloadContextById>>)
    vi.mocked(getDiskSpace).mockResolvedValue({ free: 10, total: 20 })
    vi.mocked(resolveModelsPresence).mockResolvedValue({
      presence: new Map([[SAMPLE_ID, true]]),
      timedOut: false
    })

    const { options, diskSpace } = await getPerformanceTestExampleCatalog('inst-1')

    expect(diskSpace).toEqual({ free: 10, total: 20 })
    expect(getDiskSpace).toHaveBeenCalledWith('D:\\models')
    expect(resolveModelsPresence).toHaveBeenCalledWith(
      bundledIds,
      'inst-1',
      expect.any(Function),
      2500
    )
    expect(options.map(({ value }) => value)).toEqual(bundledIds)
    expect(options.find(({ value }) => value === SAMPLE_ID)).toEqual({
      value: SAMPLE_ID,
      label: 'Sample Live: Text to Image',
      description: 'Live description.',
      recommended: false,
      data: {
        modality: 'image',
        category: 'Image',
        name: 'Sample Live',
        task: 'Text to Image',
        thumbnailUrl: `${REPO}/templates/${SAMPLE_ID}-1.webp`,
        sizeBytes: 123,
        modelsPresent: true,
        apiNode: false
      }
    })
    expect(options.find(({ value }) => value !== SAMPLE_ID)?.data?.modelsPresent).toBe(false)
  })

  it('checks model presence against the parent editor workflow in templates/', async () => {
    vi.mocked(fetchJSON).mockImplementation(async (url) => {
      if (url === INDEX_URL) return liveIndex
      return {
        nodes: [
          {
            properties: {
              models: [
                {
                  name: 'model.safetensors',
                  url: 'https://huggingface.co/org/repo/resolve/main/model.safetensors',
                  directory: 'checkpoints'
                }
              ]
            }
          }
        ]
      }
    })
    vi.mocked(resolveModelsPresence).mockResolvedValue({ presence: new Map(), timedOut: false })
    vi.mocked(getDiskSpace).mockRejectedValue(new Error('no drive'))

    const { diskSpace } = await getPerformanceTestExampleCatalog('inst-1')
    const resolveModels = vi.mocked(resolveModelsPresence).mock.calls[0]![2]

    expect(diskSpace).toBeNull()
    await expect(resolveModels(SAMPLE_ID)).resolves.toEqual([
      {
        filename: 'model.safetensors',
        url: 'https://huggingface.co/org/repo/resolve/main/model.safetensors',
        directory: 'checkpoints'
      }
    ])
    expect(fetchJSON).toHaveBeenCalledWith(`${REPO}/templates/${SAMPLE_ID}.json`)
  })

  it('falls back to the bundled snapshots when the template index is unreachable', async () => {
    vi.mocked(fetchJSON).mockRejectedValue(new Error('offline'))
    vi.mocked(resolveModelsPresence).mockResolvedValue({ presence: new Map(), timedOut: false })

    const { options } = await getPerformanceTestExampleCatalog('inst-1')
    const snapshot = benchmarkTemplates.templates[0]!

    expect(options.map(({ value }) => value)).toEqual(bundledIds)
    expect(options[0]).toMatchObject({
      value: snapshot.id,
      label: snapshot.snapshot.title,
      data: {
        sizeBytes: snapshot.snapshot.sizeBytes,
        thumbnailUrl: `${REPO}/templates/${snapshot.id}-1.${snapshot.snapshot.mediaSubtype}`
      }
    })
  })

  it('pairs the parent editor workflow from templates/ with the API prompt from benchmarks/', async () => {
    serveRepo()

    await expect(loadPerformanceTestExampleArtifacts(SAMPLE_ID)).resolves.toEqual({
      template: expect.objectContaining({ id: SAMPLE_ID, sizeBytes: 123 }),
      editorWorkflow,
      apiWorkflow
    })
    expect(fetchJSON).toHaveBeenCalledWith(`${REPO}/templates/${SAMPLE_ID}.json`, {
      refresh: true
    })
    expect(fetchJSON).toHaveBeenCalledWith(`${REPO}/benchmarks/${SAMPLE_ID}.json`, {
      refresh: true
    })
  })

  it('rejects a parent template that is not an editor workflow', async () => {
    vi.mocked(fetchJSON).mockImplementation(async (url) => (url === INDEX_URL ? liveIndex : {}))

    await expect(loadPerformanceTestExampleArtifacts(SAMPLE_ID)).rejects.toThrow(
      'example workflow template is invalid'
    )
  })

  it('distinguishes an unreachable repository, a missing file and other HTTP errors', async () => {
    let artifactError: Error
    vi.mocked(fetchJSON).mockImplementation(async (url) => {
      if (url === INDEX_URL) return liveIndex
      throw artifactError
    })

    artifactError = new Error('net::ERR_NAME_NOT_RESOLVED')
    await expect(loadPerformanceTestExampleArtifacts(SAMPLE_ID)).rejects.toMatchObject({
      name: 'ExampleWorkflowFetchError',
      reason: 'offline'
    })

    artifactError = new Error('HTTP 404')
    await expect(loadPerformanceTestExampleArtifacts(SAMPLE_ID)).rejects.toMatchObject({
      name: 'ExampleWorkflowFetchError',
      reason: 'unavailable'
    })

    artifactError = new Error('HTTP 500')
    const failure = loadPerformanceTestExampleArtifacts(SAMPLE_ID)
    await expect(failure).rejects.toThrow('HTTP 500')
    await expect(failure).rejects.not.toBeInstanceOf(ExampleWorkflowFetchError)
  })

  it('rejects an id outside the benchmark list before downloading anything', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(liveIndex)

    await expect(loadPerformanceTestExampleArtifacts('not_a_benchmark')).rejects.toThrow(
      'unavailable for performance testing'
    )
    expect(fetchJSON).toHaveBeenCalledTimes(1)
    expect(fetchJSON).toHaveBeenCalledWith(INDEX_URL)
  })

  describe('example model download', () => {
    const installation = { id: 'inst-1' } as InstallationRecord
    const summary = (patch: Partial<TemplateDownloadSummary>): TemplateDownloadSummary => ({
      status: 'resolving',
      percent: -1,
      receivedBytes: 0,
      totalBytes: 123,
      doneCount: 0,
      fileCount: 0,
      fileIndex: 0,
      currentFile: '',
      speedMBs: 0,
      etaSecs: -1,
      ...patch
    })

    /** Start a download for a fresh session, followed by a fake page. */
    async function startDownload(sessionId: string) {
      serveRepo()
      const artifacts = await loadPerformanceTestExampleArtifacts(SAMPLE_ID)
      // Platform-native, like the paths the main process stores (CI runs on Linux).
      const workflowFilePath = path.join('benchmarks', sessionId, `${SAMPLE_ID}.json`)
      let publish: (summary: TemplateDownloadSummary) => void = () => {}
      vi.mocked(subscribeTemplateDownload).mockImplementation((_id, listener) => {
        publish = listener
        listener(summary({}))
        return () => {}
      })
      const page = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        isDestroyed: vi.fn(() => false)
      })
      const onPageGone = vi.fn()
      const initial = startExampleModelDownload(
        installation,
        workflowFilePath,
        artifacts,
        page as unknown as ExampleDownloadPage,
        onPageGone
      )
      return {
        workflowFilePath,
        taskId: `performance-test-download:${sessionId}`,
        page,
        onPageGone,
        initial,
        publish: (patch: Partial<TemplateDownloadSummary>) => publish(summary(patch))
      }
    }

    const watchedEvents = ['destroyed', 'render-process-gone', 'did-start-navigation']
    const watchers = (page: EventEmitter): number =>
      watchedEvents.reduce((count, event) => count + page.listenerCount(event), 0)

    it('runs one background model download per prepared session and sends its progress to the page', async () => {
      const { workflowFilePath, taskId, page, onPageGone, initial, publish } =
        await startDownload('20260930120000')

      expect(startTemplateDownloadTask).toHaveBeenCalledWith(
        taskId,
        installation,
        [{ id: SAMPLE_ID, workflowJson: editorWorkflow }],
        123,
        { sendOutput: expect.any(Function) }
      )
      expect(subscribeTemplateDownload).toHaveBeenCalledWith(taskId, expect.any(Function))
      // The summary reported at subscribe time is returned, not sent.
      expect(initial).toEqual({ status: 'resolving', percent: -1, message: expect.any(String) })
      expect(page.send).not.toHaveBeenCalled()

      publish({ status: 'error', percent: 0, error: 'insufficient-disk' })
      expect(page.send).toHaveBeenCalledWith('performance-test-example-download', {
        filePath: workflowFilePath,
        download: {
          status: 'error',
          percent: 0,
          message: expect.any(String),
          error: 'insufficient-disk'
        }
      })
      // A settled download no longer depends on its page.
      expect(watchers(page)).toBe(0)
      page.emit('destroyed')
      expect(onPageGone).not.toHaveBeenCalled()
      expect(forgetTemplateDownload).not.toHaveBeenCalled()
    })

    it.each(['destroyed', 'render-process-gone'])(
      'stops the download when its page is %s',
      async (event) => {
        const { taskId, page, onPageGone } = await startDownload('20260930120001')

        page.emit(event)

        expect(forgetTemplateDownload).toHaveBeenCalledWith(taskId)
        expect(onPageGone).toHaveBeenCalledOnce()
        expect(watchers(page)).toBe(0)
      }
    )

    it('stops the download when its page loads another document, not on in-page navigation', async () => {
      const { taskId, page, onPageGone } = await startDownload('20260930120002')

      page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
      page.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
      expect(onPageGone).not.toHaveBeenCalled()

      page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      expect(forgetTemplateDownload).toHaveBeenCalledWith(taskId)
      expect(onPageGone).toHaveBeenCalledOnce()
    })

    it('stops watching the page when the download is cancelled', async () => {
      const { workflowFilePath, taskId, page, onPageGone } = await startDownload('20260930120003')

      cancelExampleModelDownload(workflowFilePath)

      expect(forgetTemplateDownload).toHaveBeenCalledWith(taskId)
      expect(watchers(page)).toBe(0)
      page.emit('destroyed')
      expect(onPageGone).not.toHaveBeenCalled()
    })
  })
})
