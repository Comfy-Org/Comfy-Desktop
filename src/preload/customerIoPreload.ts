import { contextBridge, ipcRenderer, webFrame } from 'electron'
import script from 'virtual:customerio-script'
import { CUSTOMER_IO_ACTION, CUSTOMER_IO_READY, CUSTOMER_IO_STATE } from '../shared/customerIo'
import type { CustomerIoSession } from '../shared/customerIo'

/** Runs the browser SDK in an eligible page's DOM, never in the privileged preload world. */
export function startCustomerIoMessaging(): void {
  let bridgeInstalled = false
  let installed = false
  ipcRenderer.on(CUSTOMER_IO_STATE, (_event, session: CustomerIoSession | null) => {
    if (!installed && !session) return
    let code = ''
    if (!installed) {
      if (!bridgeInstalled) {
        contextBridge.exposeInMainWorld('__comfyCustomerIoOpenLink', (action: string) =>
          ipcRenderer.sendSync(CUSTOMER_IO_ACTION, action)
        )
        bridgeInstalled = true
      }
      code = script
      installed = true
    }
    code += `\nglobalThis.__comfyCustomerIo.update(${JSON.stringify(session)});`
    void webFrame.executeJavaScript(code).catch(() => {
      installed = false
      console.warn('Desktop messaging could not initialize')
    })
  })
  window.addEventListener('DOMContentLoaded', () => ipcRenderer.send(CUSTOMER_IO_READY), {
    once: true
  })
  window.addEventListener('online', () => ipcRenderer.send(CUSTOMER_IO_READY))
}
