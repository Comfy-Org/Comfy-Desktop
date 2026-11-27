import { ipcMain } from 'electron'
import { usableLocalBuilds } from '../../apps/localBuild'
import { cancelCatalogWorkflowDownload, launchCatalogWorkflow } from '../../catalog/launchWorkflow'
import { catalogWorkflowNeeds } from '../../catalog/workflowNeeds'
import {
  hubUrlForListedWorkflow,
  listCatalogWorkflows,
  listHomeWorkflows
} from '../../catalog/workflows'
import { productLink } from '../../../shared/productLink'
import { getLocale } from '../i18n'
import { tryOpenExternalUrl } from '../openExternal'

export function registerCatalogHandlers(): void {
  ipcMain.handle('catalog:list-home-workflows', () => listHomeWorkflows(getLocale()))

  ipcMain.handle('catalog:list-workflows', () => listCatalogWorkflows(getLocale()))

  ipcMain.handle('catalog:local-build-versions', async () =>
    Object.fromEntries((await usableLocalBuilds()).map((build) => [build.id, build.version]))
  )

  ipcMain.handle(
    'catalog:launch-workflow',
    (event, id: unknown, target: unknown, workspaceId: unknown, options: unknown) =>
      launchCatalogWorkflow(event.sender, id, target, workspaceId, options)
  )

  ipcMain.handle('catalog:cancel-workflow-download', (_event, id: unknown, build: unknown) =>
    cancelCatalogWorkflowDownload(id, build)
  )

  ipcMain.handle('catalog:workflow-needs', (_event, id: unknown) => catalogWorkflowNeeds(id))

  ipcMain.handle('catalog:open-workflow', (_event, id: unknown) => {
    const hubUrl = typeof id === 'string' ? hubUrlForListedWorkflow(id) : null
    return hubUrl ? tryOpenExternalUrl(productLink(hubUrl, 'workflow_dialog_hub')) : false
  })
}
