import { ipcMain } from 'electron'
import { getCrash, getAllCrashes } from '../crashBuffer'
import type { ComfyExitedData } from '../../../types/ipc'

export function registerCrashHandlers(): void {
  ipcMain.handle(
    'get-last-crash-error',
    (_event, installationId: string): ComfyExitedData | null => {
      if (!installationId) return null
      return getCrash(installationId)
    }
  )

  ipcMain.handle('get-crash-instances', (): ComfyExitedData[] => getAllCrashes())
}
