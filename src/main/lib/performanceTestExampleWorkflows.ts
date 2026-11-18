import path from 'node:path'
import type { WebContents } from 'electron'
import benchmarkTemplates from '../../../assets/benchmark-templates.json'
import { getDiskSpace } from './disk'
import { fetchJSON } from './fetch'
import {
  getModelsBaseDir,
  resolveDownloadContextById,
  resolveModelsPresence
} from './modelDownloadPaths'
import {
  isPersistableTemplateId,
  RAW_TEMPLATES_BASE,
  TEMPLATE_MODALITY_ORDER,
  type TemplateModality,
  type TemplateSnapshot
} from '../sources/standalone/curatedTemplates'
import {
  hydrateTemplates,
  toTemplateFieldOption,
  type HydratedTemplate
} from '../sources/standalone/templateCatalog'
import {
  formatTemplateSubStatus,
  isTerminal,
  type TemplateDownloadSummary
} from '../sources/standalone/templateDownloadCore'
import {
  forgetTemplateDownload,
  startTemplateDownloadTask,
  subscribeTemplateDownload
} from '../sources/standalone/templateDownloadTask'
import { resolveTemplateModelsFromJson } from '../sources/standalone/templateModels'
import type { InstallationRecord } from '../installations'
import type { FieldOption } from '../types/sources'
import type { DiskSpaceInfo, ExampleWorkflowDownload } from '../../types/ipc'

const BENCHMARKS_BASE = RAW_TEMPLATES_BASE.replace(/\/templates$/, '/benchmarks')
const MODELS_PRESENT_BUDGET_MS = 2500

interface BenchmarkTemplate {
  id: string
  modality: TemplateModality
  recommended?: boolean
  snapshot: TemplateSnapshot
}

function isBenchmarkTemplate(value: unknown): value is BenchmarkTemplate {
  const entry = value as Partial<BenchmarkTemplate> | null
  const snapshot = entry?.snapshot
  return (
    isPersistableTemplateId(entry?.id) &&
    TEMPLATE_MODALITY_ORDER.includes(entry!.modality as TemplateModality) &&
    (entry!.recommended === undefined || typeof entry!.recommended === 'boolean') &&
    typeof snapshot?.title === 'string' &&
    typeof snapshot.description === 'string' &&
    typeof snapshot.sizeBytes === 'number' &&
    typeof snapshot.mediaSubtype === 'string'
  )
}

const BENCHMARK_TEMPLATES: BenchmarkTemplate[] =
  benchmarkTemplates.templates.filter(isBenchmarkTemplate)

function loadExampleCatalog(): Promise<HydratedTemplate[]> {
  return hydrateTemplates(BENCHMARK_TEMPLATES)
}

function editorWorkflowUrl(templateId: string): string {
  return `${RAW_TEMPLATES_BASE}/${encodeURIComponent(templateId)}.json`
}

async function modelsDiskSpace(installationId: string): Promise<DiskSpaceInfo | null> {
  try {
    const context = await resolveDownloadContextById(installationId)
    return await getDiskSpace(context ? context.downloadBaseDir : getModelsBaseDir())
  } catch {
    return null
  }
}

export async function getPerformanceTestExampleCatalog(
  installationId: string
): Promise<{ options: FieldOption[]; diskSpace: DiskSpaceInfo | null }> {
  const catalog = await loadExampleCatalog()
  const [{ presence }, diskSpace] = await Promise.all([
    resolveModelsPresence(
      catalog.map(({ id }) => id),
      installationId,
      async (id) => resolveTemplateModelsFromJson(await fetchJSON(editorWorkflowUrl(id))),
      MODELS_PRESENT_BUDGET_MS
    ),
    modelsDiskSpace(installationId)
  ])
  return {
    options: catalog.map((template) =>
      toTemplateFieldOption(template, presence.get(template.id) ?? false)
    ),
    diskSpace
  }
}

export type ExampleWorkflowFetchFailure = 'offline' | 'unavailable'

export class ExampleWorkflowFetchError extends Error {
  constructor(readonly reason: ExampleWorkflowFetchFailure) {
    super(
      reason === 'offline'
        ? 'Connect to the internet to download example workflows.'
        : 'This example workflow is not available yet.'
    )
    this.name = 'ExampleWorkflowFetchError'
  }
}

export interface PerformanceTestExampleArtifacts {
  template: HydratedTemplate
  editorWorkflow: unknown
  apiWorkflow: unknown
}

export async function loadPerformanceTestExampleArtifacts(
  templateId: string
): Promise<PerformanceTestExampleArtifacts> {
  const template = (await loadExampleCatalog()).find(({ id }) => id === templateId)
  if (!template) {
    throw new Error('This example workflow is unavailable for performance testing.')
  }

  let editorWorkflow: unknown
  let apiWorkflow: unknown
  try {
    ;[editorWorkflow, apiWorkflow] = await Promise.all([
      fetchJSON(editorWorkflowUrl(templateId), { refresh: true }),
      fetchJSON(`${BENCHMARKS_BASE}/${encodeURIComponent(templateId)}.json`, { refresh: true })
    ])
  } catch (error) {
    const message = (error as Error)?.message ?? ''
    if (/\bnet::ERR_/.test(message)) throw new ExampleWorkflowFetchError('offline')
    if (/^HTTP 404\b/.test(message)) throw new ExampleWorkflowFetchError('unavailable')
    throw error
  }
  if (!Array.isArray((editorWorkflow as { nodes?: unknown } | null)?.nodes)) {
    throw new Error('The example workflow template is invalid.')
  }
  return { template, editorWorkflow, apiWorkflow }
}

function exampleDownloadTaskId(workflowFilePath: string): string {
  return `performance-test-download:${path.basename(path.dirname(workflowFilePath))}`
}

function toExampleDownload(summary: TemplateDownloadSummary): ExampleWorkflowDownload {
  return {
    status: summary.status,
    percent: summary.percent,
    message: formatTemplateSubStatus(summary),
    error: summary.error
  }
}

export type ExampleDownloadPage = Pick<WebContents, 'send' | 'isDestroyed' | 'on' | 'off'>

const _pageWatches = new Map<string, () => void>()

function watchPageGone(page: ExampleDownloadPage, onGone: () => void): () => void {
  const gone = (): void => {
    stop()
    onGone()
  }
  const navigated = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
    if (details.isMainFrame && !details.isSameDocument) gone()
  }
  function stop(): void {
    page.off('destroyed', gone)
    page.off('render-process-gone', gone)
    page.off('did-start-navigation', navigated)
  }
  page.on('destroyed', gone)
  page.on('render-process-gone', gone)
  page.on('did-start-navigation', navigated)
  return stop
}

export function startExampleModelDownload(
  installation: InstallationRecord,
  workflowFilePath: string,
  { template, editorWorkflow }: PerformanceTestExampleArtifacts,
  page: ExampleDownloadPage,
  onPageGone: () => void
): ExampleWorkflowDownload {
  const taskId = exampleDownloadTaskId(workflowFilePath)
  startTemplateDownloadTask(
    taskId,
    installation,
    template.id,
    template.sizeBytes,
    { sendOutput: () => {} },
    editorWorkflow
  )
  const stopWatching = watchPageGone(page, () => {
    _pageWatches.delete(taskId)
    forgetTemplateDownload(taskId)
    onPageGone()
  })
  _pageWatches.set(taskId, stopWatching)
  let initial: ExampleWorkflowDownload | undefined
  subscribeTemplateDownload(taskId, (summary) => {
    const download = toExampleDownload(summary)
    if (isTerminal(summary.status)) {
      stopWatching()
      _pageWatches.delete(taskId)
    }
    if (!initial) initial = download
    else if (!page.isDestroyed()) {
      page.send('performance-test-example-download', { filePath: workflowFilePath, download })
    }
  })
  return initial!
}

export function cancelExampleModelDownload(workflowFilePath: string): void {
  const taskId = exampleDownloadTaskId(workflowFilePath)
  _pageWatches.get(taskId)?.()
  _pageWatches.delete(taskId)
  forgetTemplateDownload(taskId)
}
