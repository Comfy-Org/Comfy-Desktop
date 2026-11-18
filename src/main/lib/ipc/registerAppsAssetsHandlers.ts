import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import { assetFromPath, assetRunValue, readAsset, recentAssets } from '../../apps/appAssets'
import type { AssetResult } from '../../apps/appAssets'
import { areAppsEnabled } from '../../apps/appsConfig'
import { isAppsPageSender } from '../../apps/appsPages'
import type { ComfyDesktopAssetFailure } from '../../../types/comfyDesktopBridge'

export const APPS_ASSETS_CHANNELS = {
  recent: 'apps-assets:recent',
  fromPath: 'apps-assets:from-path',
  read: 'apps-assets:read',
  valueFor: 'apps-assets:value-for'
} as const

const MISSING: ComfyDesktopAssetFailure = { error: 'missing' }

async function isFromAppsPage(event: IpcMainInvokeEvent): Promise<boolean> {
  return isAppsPageSender(event.sender, event.senderFrame) && (await areAppsEnabled())
}

function forAppsPage<T>(
  answer: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<AssetResult<T>>
): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<AssetResult<T>> {
  return async (event, ...args) => {
    if (!(await isFromAppsPage(event))) return MISSING
    return answer(event, ...args).catch(() => MISSING)
  }
}

export function registerAppsAssetsHandlers(): void {
  ipcMain.handle(APPS_ASSETS_CHANNELS.recent, async (event, request: unknown) =>
    (await isFromAppsPage(event)) ? recentAssets(event.sender, request).catch(() => []) : []
  )
  ipcMain.handle(
    APPS_ASSETS_CHANNELS.fromPath,
    forAppsPage((event, filePath, request) => assetFromPath(event.sender, filePath, request))
  )
  ipcMain.handle(
    APPS_ASSETS_CHANNELS.read,
    forAppsPage((event, ref) => readAsset(event.sender, ref))
  )
  ipcMain.handle(
    APPS_ASSETS_CHANNELS.valueFor,
    forAppsPage((event, ref, request) => assetRunValue(event.sender, ref, request))
  )
}
