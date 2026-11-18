import { ipcMain } from 'electron'
import { launchCatalogWorkflow } from '../../catalog/launchWorkflow'
import {
  hubUrlForListedWorkflow,
  listCatalogWorkflows,
  listHomeWorkflows
} from '../../catalog/workflows'
import { getLocale } from '../i18n'
import { tryOpenExternalUrl } from '../openExternal'

export function registerCatalogHandlers(): void {
  ipcMain.handle('catalog:list-home-workflows', () => listHomeWorkflows(getLocale()))

  ipcMain.handle('catalog:list-workflows', () => listCatalogWorkflows(getLocale()))

  ipcMain.handle(
    'catalog:launch-workflow',
    (event, id: unknown, target: unknown, workspaceId: unknown) =>
      launchCatalogWorkflow(event.sender, id, target, workspaceId)
  )

  ipcMain.handle('catalog:open-workflow', (_event, id: unknown) => {
    const hubUrl = typeof id === 'string' ? hubUrlForListedWorkflow(id) : null
    return hubUrl ? tryOpenExternalUrl(hubUrl) : false
  })
}
