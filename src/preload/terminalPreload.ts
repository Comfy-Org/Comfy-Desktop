import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { ComfyDesktop2TerminalBridge, TerminalRestore } from '../types/comfyDesktopBridge'

const Terminal: ComfyDesktop2TerminalBridge = {
  subscribe: (): Promise<TerminalRestore> => ipcRenderer.invoke('terminal-subscribe', null),
  unsubscribe: (): Promise<void> => ipcRenderer.invoke('terminal-unsubscribe', null),
  write: (data: string): Promise<void> => ipcRenderer.invoke('terminal-write', null, data),
  resize: (cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal-resize', null, cols, rows),
  restart: (): Promise<TerminalRestore> => ipcRenderer.invoke('terminal-restart', null),
  openPopout: async (): Promise<void> => {},
  onOutput: (callback: (data: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: { data: string }) => callback(payload.data)
    ipcRenderer.on('terminal-output', handler)
    return () => ipcRenderer.removeListener('terminal-output', handler)
  },
  onExited: (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on('terminal-exited', handler)
    return () => ipcRenderer.removeListener('terminal-exited', handler)
  }
}

contextBridge.exposeInMainWorld('__comfyDesktopTerminal', Terminal)
