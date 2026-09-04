import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ComfyDesktop2BridgeImplementation,
  ComfyDesktop2LogsBridge,
  ComfyDesktop2TelemetryBridge,
  ComfyDesktop2TerminalBridge,
  ComfyDownloadProgress,
  LogsOutputMsg,
  LogsRestore,
  TerminalRestore
} from '../types/comfyDesktopBridge'
import { startLocalFirebaseAuthMonitor } from './localFirebaseAuthMonitor'

export type LegacyTerminalBridge = ComfyDesktop2TerminalBridge & {
  restore(): Promise<TerminalRestore>
}

const EMPTY_TERMINAL_RESTORE: TerminalRestore = {
  buffer: [],
  size: { cols: 80, rows: 30 },
  exited: true
}

function sendTelemetry(channel: string, payload: unknown): void {
  try {
    ipcRenderer.send(channel, payload)
  } catch {
    // Telemetry must never break hosted frontend code.
  }
}

function openTerminal(): Promise<boolean> {
  return ipcRenderer.invoke('desktop2-open-terminal')
}

function openMcpSetup(): Promise<boolean> {
  return ipcRenderer.invoke('desktop2-open-mcp-setup')
}

function openTerminalPopout(): Promise<void> {
  return ipcRenderer.invoke('desktop2-open-terminal-popout')
}

async function openTerminalWithEmptyRestore(): Promise<TerminalRestore> {
  await openTerminal()
  return EMPTY_TERMINAL_RESTORE
}

const Terminal: LegacyTerminalBridge = {
  subscribe: openTerminalWithEmptyRestore,
  unsubscribe: async (): Promise<void> => {},
  write: async (): Promise<void> => {},
  resize: async (): Promise<void> => {},
  restart: async (): Promise<TerminalRestore> => EMPTY_TERMINAL_RESTORE,
  openPopout: openTerminalPopout,
  onOutput: (): (() => void) => () => {},
  onExited: (): (() => void) => () => {},
  restore: openTerminalWithEmptyRestore
}

/**
 * Read-only logs bridge. Subscribes to the shared per-install log
 * broadcast that mirrors every `comfy-output` IPC send. Used by the
 * pop-out logs window and (eventually) any other surface that wants the
 * raw stdout/stderr stream without owning the launcher.
 */
const Logs: ComfyDesktop2LogsBridge = {
  /** Register as a subscriber and return the current ring-buffer
   *  contents for an immediate paint. Subsequent chunks arrive on
   *  the `onOutput` channel. */
  subscribe: (installationId?: string): Promise<LogsRestore> =>
    ipcRenderer.invoke('logs-subscribe', installationId ?? null),
  unsubscribe: (installationId?: string): Promise<void> =>
    ipcRenderer.invoke('logs-unsubscribe', installationId ?? null),
  /** Open a separate Electron window subscribed to the same broadcast.
   *  Main resolves the installationId from the caller's comfyView sender
   *  so the inline injection doesn't need to know its own ID. */
  openPopout: (): Promise<void> => ipcRenderer.invoke('logs-popout-open', null),
  onOutput: (callback: (msg: LogsOutputMsg) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: LogsOutputMsg) => callback(payload)
    ipcRenderer.on('logs-output', handler)
    return () => ipcRenderer.removeListener('logs-output', handler)
  }
}

const reportFirebaseAuthState: NonNullable<
  ComfyDesktop2TelemetryBridge['reportFirebaseAuthState']
> = (state): void => sendTelemetry('telemetry:firebaseAuthState', state)

const captureException: NonNullable<ComfyDesktop2TelemetryBridge['captureException']> = (
  error,
  properties
): void =>
  sendTelemetry('telemetry:captureException', {
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    properties
  })

const Telemetry: ComfyDesktop2TelemetryBridge = {
  capture: (event, properties): void => sendTelemetry('telemetry:capture', { event, properties }),
  captureException,
  reportFirebaseAuthState
}

startLocalFirebaseAuthMonitor(reportFirebaseAuthState)

const bridge = {
  isRemote: (): boolean => ipcRenderer.sendSync('desktop2-is-remote') as boolean,
  openModelAccessPage: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke('desktop2-open-model-access-page', { url })
  },
  downloadModel: (url: string, filename: string, directory: string): Promise<boolean> => {
    return ipcRenderer.invoke('desktop2-download-model', { url, filename, directory })
  },
  downloadAsset: (url: string, filename: string, authToken?: string): Promise<boolean> => {
    return ipcRenderer.invoke('desktop2-download-asset', {
      url,
      filename,
      authToken: authToken || undefined
    })
  },
  pauseDownload: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke('model-download-pause', { url })
  },
  resumeDownload: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke('model-download-resume', { url })
  },
  cancelDownload: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke('model-download-cancel', { url })
  },
  onDownloadProgress: (callback: (data: ComfyDownloadProgress) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) =>
      callback(data as ComfyDownloadProgress)
    ipcRenderer.on('desktop2-download-progress', handler)
    return () => ipcRenderer.removeListener('desktop2-download-progress', handler)
  },
  reportTheme: (bg: string, text: string): void => {
    ipcRenderer.send('desktop2-theme-report', { bg, text })
  },
  openTerminal,
  openMcpSetup,
  Terminal,
  Logs,
  Telemetry
} satisfies ComfyDesktop2BridgeImplementation

contextBridge.exposeInMainWorld('__comfyDesktop2', bridge)
