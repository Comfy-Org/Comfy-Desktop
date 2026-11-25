import type { WebContents } from 'electron'
import type { ComfyDesktopOpenInComfy } from '../../types/comfyDesktopBridge'
import type { CatalogWorkflowDownload, CatalogWorkflowTarget } from '../../types/ipc'
import { PERSONAL_WORKSPACE_ID } from '../../shared/workspaces'
import { catalogBuildRefusal, type CatalogBuildRules } from '../apps/catalogBuild'
import { usableLocalBuilds } from '../apps/localBuild'
import { openCatalogInComfy } from '../apps/openInComfy'
import { isBuildId, workflowNameFromTitle } from '../apps/openRequest'
import { getCloudSession } from '../devplatform/session'
import * as installations from '../installations'
import { t } from '../lib/i18n'
import { missingModelFiles } from '../lib/modelDownloadPaths'
import { DISK_SPACE_ERROR, isTerminal } from '../sources/standalone/templateDownloadCore'
import {
  cancelTemplateDownload,
  forgetTemplateDownload,
  startTemplateDownloadTask,
  subscribeTemplateDownload
} from '../sources/standalone/templateDownloadTask'
import { fetchEditorGraph } from './editorGraph'
import { catalogWorkflowModels, knownDownloadBytes } from './workflowNeeds'
import { listedWorkflow } from './workflows'

function readTarget(value: unknown): CatalogWorkflowTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const { where, build } = value as { where?: unknown; build?: unknown }
  if (where === 'cloud' && build === undefined) return { where }
  return where === 'local' && isBuildId(build) ? { where, build } : null
}

function readWorkspaceId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 128) return null
  return value.trim() === value && value.length > 0 ? value : null
}

async function canOpenCloudWorkspace(
  workspaceId: string,
  session: ReturnType<typeof getCloudSession>
): Promise<boolean> {
  if (workspaceId === PERSONAL_WORKSPACE_ID) return true
  const status = session.status()
  if (!status.signedIn) return false
  if (status.workspaceId === workspaceId) return true
  return (await session.listWorkspaces()).some(({ id }) => id === workspaceId)
}

function readOptions(value: unknown): { downloadMissing: boolean } {
  const options = typeof value === 'object' && value !== null ? value : {}
  return { downloadMissing: (options as { downloadMissing?: unknown }).downloadMissing === true }
}

type DownloadOutcome = { failure: string | null; downloaded: boolean } | 'cancelled'

const downloadCancels = new Map<string, Set<() => void>>()

function downloadTaskId(id: string, build: string): string {
  return `catalog-workflow:${id}:${build}`
}

export function cancelCatalogWorkflowDownload(id: unknown, build: unknown): boolean {
  if (typeof id !== 'string' || !isBuildId(build)) return false
  const cancels = downloadCancels.get(downloadTaskId(id, build))
  if (!cancels) return false
  for (const cancel of [...cancels]) cancel()
  return true
}

async function refuseModelsInto(build: string, rules: CatalogBuildRules): Promise<string | null> {
  const local = (await usableLocalBuilds()).find((candidate) => candidate.id === build)
  return local ? catalogBuildRefusal(local, rules) : t('apps.local.openUnknownBuild')
}

async function downloadMissingModels(
  page: WebContents,
  id: string,
  build: string,
  graph: Record<string, unknown>
): Promise<DownloadOutcome> {
  const installation = await installations.get(build)
  if (!installation) return { failure: t('workflowLaunch.openFailed'), downloaded: false }
  const missing = await missingModelFiles(build, catalogWorkflowModels(graph))
  if (missing.length === 0) return { failure: null, downloaded: false }
  const taskId = downloadTaskId(id, build)
  startTemplateDownloadTask(
    taskId,
    installation,
    id,
    await knownDownloadBytes(missing),
    { sendOutput: () => {}, models: missing, skipInputAssets: true },
    graph
  )
  return new Promise((resolve) => {
    const cancels = downloadCancels.get(taskId) ?? new Set<() => void>()
    downloadCancels.set(taskId, cancels)
    const cancel = (): void => {
      cancelTemplateDownload(taskId)
      finish('cancelled')
    }
    const finish = (outcome: DownloadOutcome): void => {
      cancels.delete(cancel)
      if (cancels.size === 0 && downloadCancels.get(taskId) === cancels) {
        downloadCancels.delete(taskId)
      }
      queueMicrotask(() => {
        stop()
        forgetTemplateDownload(taskId)
      })
      resolve(outcome)
    }
    cancels.add(cancel)
    const stop = subscribeTemplateDownload(taskId, (summary) => {
      if (!page.isDestroyed()) {
        const progress: CatalogWorkflowDownload = {
          id,
          build,
          receivedBytes: summary.receivedBytes,
          totalBytes: summary.totalBytes
        }
        page.send('catalog:workflow-download', progress)
      }
      if (!isTerminal(summary.status)) return
      if (summary.status === 'done') finish({ failure: null, downloaded: true })
      else if (summary.status === 'cancelled') finish('cancelled')
      else if (summary.error === DISK_SPACE_ERROR) {
        finish({ failure: t('workflowLaunch.noDiskSpace'), downloaded: false })
      } else finish({ failure: t('workflowLaunch.downloadFailed'), downloaded: false })
    })
  })
}

export async function launchCatalogWorkflow(
  page: WebContents,
  id: unknown,
  rawTarget: unknown,
  rawWorkspaceId: unknown,
  rawOptions?: unknown
): Promise<ComfyDesktopOpenInComfy> {
  const target = readTarget(rawTarget)
  const { downloadMissing } = readOptions(rawOptions)
  const workspaceId = readWorkspaceId(rawWorkspaceId)
  const workflow = typeof id === 'string' ? listedWorkflow(id) : undefined
  if (
    !target ||
    !workspaceId ||
    !workflow ||
    (target.where === 'local' ? !workflow.card.canOpenLocal : !workflow.card.canOpenCloud)
  ) {
    return { opened: false, error: t('workflowLaunch.unavailable') }
  }

  const session = getCloudSession()
  const subject = session.currentSubject()
  const scope = {
    workspaceId,
    minComfyUIVersion: workflow.card.minComfyUIVersion,
    isCurrent: () => !page.isDestroyed() && subject === session.currentSubject()
  }
  const name = workflowNameFromTitle(workflow.card.title, 'Catalog workflow')
  try {
    if (
      (target.where === 'cloud' && !(await canOpenCloudWorkspace(workspaceId, session))) ||
      !scope.isCurrent()
    ) {
      return { opened: false, error: t('workflowLaunch.openFailed') }
    }
    const graph = workflow.editorGraphUrl
      ? await fetchEditorGraph(workflow.editorGraphUrl).catch(() => null)
      : null
    if (!scope.isCurrent()) return { opened: false, error: t('workflowLaunch.openFailed') }
    let refreshModels = false
    if (graph && target.where === 'local' && downloadMissing) {
      const refusal = await refuseModelsInto(target.build, scope)
      if (refusal) return { opened: false, error: refusal }
      const outcome = await downloadMissingModels(page, workflow.card.id, target.build, graph)
      if (outcome === 'cancelled') {
        return { opened: false, error: t('workflowLaunch.downloadCancelled') }
      }
      if (outcome.failure) return { opened: false, error: outcome.failure }
      if (!scope.isCurrent()) return { opened: false, error: t('workflowLaunch.openFailed') }
      refreshModels = outcome.downloaded
    }
    if (graph) {
      return await openCatalogInComfy(page, { ...target, graph, name, refreshModels }, scope)
    }
    if (target.where === 'cloud' && workflow.cloudPrompt) {
      return await openCatalogInComfy(
        page,
        { ...target, prompt: workflow.cloudPrompt, name },
        scope
      )
    }
    return { opened: false, error: t('workflowLaunch.openFailed') }
  } catch {
    return { opened: false, error: t('workflowLaunch.openFailed') }
  }
}
