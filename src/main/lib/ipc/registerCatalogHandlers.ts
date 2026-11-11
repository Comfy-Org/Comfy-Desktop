import { ipcMain, shell } from 'electron'
import { hubUrlForListedWorkflow, listHomeWorkflows } from '../../catalog/workflows'
import { getLocale } from '../i18n'

export function registerCatalogHandlers(): void {
  ipcMain.handle('catalog:list-home-workflows', () => listHomeWorkflows(getLocale()))

  ipcMain.handle('catalog:open-workflow', async (_event, id: unknown) => {
    if (typeof id !== 'string') return false
    const hubUrl = hubUrlForListedWorkflow(id)
    if (!hubUrl) return false
    try {
      await shell.openExternal(hubUrl)
      return true
    } catch {
      return false
    }
  })
}
