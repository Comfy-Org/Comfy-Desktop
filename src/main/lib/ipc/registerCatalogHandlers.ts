import { ipcMain, shell } from 'electron'
import {
  HUB_WORKFLOWS_URL,
  hubUrlForListedWorkflow,
  listHomeWorkflows
} from '../../catalog/workflows'
import { getLocale } from '../i18n'

async function openInBrowser(url: string): Promise<boolean> {
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

export function registerCatalogHandlers(): void {
  ipcMain.handle('catalog:list-home-workflows', () => listHomeWorkflows(getLocale()))

  ipcMain.handle('catalog:open-workflow', (_event, id: unknown) => {
    const hubUrl = typeof id === 'string' ? hubUrlForListedWorkflow(id) : null
    return hubUrl ? openInBrowser(hubUrl) : false
  })

  ipcMain.handle('catalog:open-workflow-hub', () => openInBrowser(HUB_WORKFLOWS_URL))
}
