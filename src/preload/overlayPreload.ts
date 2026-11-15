import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('comfyOverlay', {
  pressed: (): void => ipcRenderer.send('comfy-overlay:pressed')
})
