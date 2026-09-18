import { contextBridge } from 'electron'
import { buildElectronApi } from './api'
import { startCustomerIoMessaging } from './customerIoPreload'

const api = buildElectronApi()
startCustomerIoMessaging()

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as Record<string, unknown>).api = api
}
