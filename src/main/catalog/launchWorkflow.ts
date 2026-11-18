import { net, type WebContents } from 'electron'
import type { ComfyDesktopOpenInComfy } from '../../types/comfyDesktopBridge'
import type { CatalogWorkflowTarget } from '../../types/ipc'
import { PERSONAL_WORKSPACE_ID } from '../../shared/workspaces'
import { openCatalogInComfy } from '../apps/openInComfy'
import { isBuildId, isEditorWorkflow, MAX_WORKFLOW_BYTES, workflowName } from '../apps/openRequest'
import { getCloudSession } from '../devplatform/session'
import { t } from '../lib/i18n'
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

async function fetchEditorGraph(url: string): Promise<Record<string, unknown>> {
  const response = await net.fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  })
  if (!response.ok || !response.body) throw new Error('Workflow download failed')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_WORKFLOW_BYTES) throw new Error('Workflow is too large')
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const graph: unknown = JSON.parse(text + decoder.decode())
  if (!isEditorWorkflow(graph)) throw new Error('Invalid editor workflow')
  return graph
}

export async function launchCatalogWorkflow(
  page: WebContents,
  id: unknown,
  rawTarget: unknown,
  rawWorkspaceId: unknown
): Promise<ComfyDesktopOpenInComfy> {
  const target = readTarget(rawTarget)
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
