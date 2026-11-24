import type { WebContents } from 'electron'
import type { ComfyDesktopOpenInComfy } from '../../types/comfyDesktopBridge'
import type { CatalogWorkflowDownload, CatalogWorkflowTarget } from '../../types/ipc'
import { meetsCatalogWorkflowMinimum } from '../../shared/catalogWorkflowCompatibility'
import { isInstallationInWorkspace, PERSONAL_WORKSPACE_ID } from '../../shared/workspaces'
import { usableLocalBuilds } from '../apps/localBuild'
import { openCatalogInComfy } from '../apps/openInComfy'
import { isBuildId, workflowName } from '../apps/openRequest'
import { getCloudSession } from '../devplatform/session'
import * as installations from '../installations'
import { t } from '../lib/i18n'
import { missingModelFiles } from '../lib/modelDownloadPaths'
import { isTerminal } from '../sources/standalone/templateDownloadCore'
import {
  forgetTemplateDownload,
  startTemplateDownloadTask,
  subscribeTemplateDownload
} from '../sources/standalone/templateDownloadTask'
import { fetchEditorGraph } from './editorGraph'
import { catalogWorkflowModels } from './workflowNeeds'
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

function downloadTaskId(id: string, build: string): string {
  return `catalog-workflow:${id}:${build}`
}

async function canReceiveModels(
  build: string,
  workspaceId: string,
  minComfyUIVersion: string | null
): Promise<boolean> {
  const installation = await installations.get(build)
  if (!installation || !isInstallationInWorkspace(installation, workspaceId)) return false
  const local = (await usableLocalBuilds()).find((candidate) => candidate.id === build)
  return local !== undefined && meetsCatalogWorkflowMinimum(local.version, minComfyUIVersion)
}

async function downloadMissingModels(
  page: WebContents,
  id: string,
  build: string,
  graph: Record<string, unknown>
): Promise<string | null> {
  const installation = await installations.get(build)
  if (!installation) return t('workflowLaunch.openFailed')
  const missing = await missingModelFiles(build, await catalogWorkflowModels(graph))
  if (missing.length === 0) return null
  const taskId = downloadTaskId(id, build)
  startTemplateDownloadTask(taskId, installation, id, 0, { sendOutput: () => {} }, graph)
  return new Promise((resolve) => {
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
      queueMicrotask(() => {
        stop()
        forgetTemplateDownload(taskId)
      })
      resolve(summary.status === 'done' ? null : t('workflowLaunch.downloadFailed'))
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
  const name = workflowName(workflow.card.title, 'Catalog workflow')
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
    if (graph && target.where === 'local' && downloadMissing) {
      if (!(await canReceiveModels(target.build, workspaceId, workflow.card.minComfyUIVersion))) {
        return { opened: false, error: t('workflowLaunch.openFailed') }
      }
      const failure = await downloadMissingModels(page, workflow.card.id, target.build, graph)
      if (failure) return { opened: false, error: failure }
      if (!scope.isCurrent()) return { opened: false, error: t('workflowLaunch.openFailed') }
    }
    if (graph) return await openCatalogInComfy(page, { ...target, graph, name }, scope)
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
