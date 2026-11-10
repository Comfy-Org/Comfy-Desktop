import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ComfyDesktop2AuthBridge,
  ComfyDesktop2AuthState,
  ComfyDesktop2BridgeImplementation,
  ComfyDesktop2LogsBridge,
  ComfyDesktop2TelemetryBridge,
  ComfyDesktop2TerminalBridge,
  ComfyDownloadProgress,
  ComfyTemplateInputAssetDownload,
  ComfyTemplateInputAssetDownloadResult,
  ComfyTemplateInputDownloadProgress,
  ComfyTemplateInputReference,
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
  } catch {}
}

function openTerminal(): Promise<boolean> {
  return ipcRenderer.invoke('desktop2-open-terminal')
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

const Logs: ComfyDesktop2LogsBridge = {
  subscribe: (installationId?: string): Promise<LogsRestore> =>
    ipcRenderer.invoke('logs-subscribe', installationId ?? null),
  unsubscribe: (installationId?: string): Promise<void> =>
    ipcRenderer.invoke('logs-unsubscribe', installationId ?? null),
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

type TemplateInputProgressCallback = (data: ComfyTemplateInputDownloadProgress) => void

const templateInputsByDownloadId = new Map<string, Map<string, ComfyTemplateInputReference>>()
const terminalTemplateInputDownloadsById = new Map<string, ComfyTemplateInputAssetDownload>()
const templateInputProgressCallbacks = new Set<TemplateInputProgressCallback>()
const MAX_BUFFERED_TERMINAL_DOWNLOADS = 50
let templateInputProgressHandler:
  | ((event: IpcRendererEvent, data: ComfyDownloadProgress) => void)
  | undefined

function templateInputReferenceKey({ templateId, assetId }: ComfyTemplateInputReference): string {
  return `${templateId}\u0000${assetId}`
}

function alreadyPresentDownloadId(templateId: string, assetId: string): string {
  return `already-present:${templateId}:${assetId}`
}

function emitTemplateInputProgress(
  download: ComfyTemplateInputAssetDownload,
  templateInputs: ComfyTemplateInputReference[]
): void {
  const progress = { ...download, templateInputs }
  for (const callback of templateInputProgressCallbacks) callback(progress)
}

function toTemplateInputAssetDownload(
  data: ComfyDownloadProgress
): ComfyTemplateInputAssetDownload | undefined {
  if (!data.id) return undefined
  return {
    downloadId: data.id,
    filename: data.filename,
    progress: data.progress,
    ...(data.receivedBytes === undefined ? {} : { receivedBytes: data.receivedBytes }),
    ...(data.totalBytes === undefined ? {} : { totalBytes: data.totalBytes }),
    status: data.status,
    ...(data.error === undefined ? {} : { error: data.error })
  }
}

function isTerminalTemplateInputDownload(download: ComfyTemplateInputAssetDownload): boolean {
  return ['completed', 'error', 'cancelled'].includes(download.status)
}

function rememberTerminalTemplateInputDownload(download: ComfyTemplateInputAssetDownload): void {
  terminalTemplateInputDownloadsById.delete(download.downloadId)
  terminalTemplateInputDownloadsById.set(download.downloadId, download)
  if (terminalTemplateInputDownloadsById.size <= MAX_BUFFERED_TERMINAL_DOWNLOADS) return
  const oldestDownloadId = terminalTemplateInputDownloadsById.keys().next().value
  if (oldestDownloadId) terminalTemplateInputDownloadsById.delete(oldestDownloadId)
}

function removeTemplateInputProgressHandler(): void {
  if (!templateInputProgressHandler) return
  ipcRenderer.removeListener('desktop2-download-progress', templateInputProgressHandler)
  templateInputProgressHandler = undefined
}

let templateInputInvokesInFlight = 0

function maybeRemoveTemplateInputProgressHandler(): void {
  if (templateInputInvokesInFlight > 0) return
  if (templateInputProgressCallbacks.size === 0 && templateInputsByDownloadId.size === 0) {
    removeTemplateInputProgressHandler()
  }
}

function ensureTemplateInputProgressHandler(): void {
  if (templateInputProgressHandler) return
  templateInputProgressHandler = (_event, data) => {
    const download = toTemplateInputAssetDownload(data)
    if (!download) return
    const isTerminal = isTerminalTemplateInputDownload(download)
    if (isTerminal) rememberTerminalTemplateInputDownload(download)
    const named = data.templateInputs
    const references =
      named && named.length > 0
        ? named
        : [...(templateInputsByDownloadId.get(download.downloadId)?.values() ?? [])]
    if (references.length === 0) return
    if (isTerminal) templateInputsByDownloadId.delete(download.downloadId)
    emitTemplateInputProgress(download, references)
    maybeRemoveTemplateInputProgressHandler()
  }
  ipcRenderer.on('desktop2-download-progress', templateInputProgressHandler)
}

function trackTemplateInputDownload(
  reference: ComfyTemplateInputReference,
  download: ComfyTemplateInputAssetDownload,
  emitSnapshot: boolean
): void {
  let references = templateInputsByDownloadId.get(download.downloadId)
  if (!references) {
    references = new Map()
    templateInputsByDownloadId.set(download.downloadId, references)
  }
  references.set(templateInputReferenceKey(reference), reference)
  ensureTemplateInputProgressHandler()
  const terminalDownload = terminalTemplateInputDownloadsById.get(download.downloadId)
  if (terminalDownload) {
    templateInputsByDownloadId.delete(download.downloadId)
    emitTemplateInputProgress(terminalDownload, [...references.values()])
    maybeRemoveTemplateInputProgressHandler()
  } else if (emitSnapshot) {
    emitTemplateInputProgress(download, [...references.values()])
  }
}

const getTemplateInputAssets: NonNullable<
  ComfyDesktop2BridgeImplementation['getTemplateInputAssets']
> = async (templateId) => {
  const assets = await ipcRenderer.invoke('desktop2-get-template-input-assets', { templateId })
  if (!assets) return null
  for (const asset of assets) {
    if (asset.activeDownload) {
      trackTemplateInputDownload(
        { templateId, assetId: asset.assetId },
        asset.activeDownload,
        false
      )
    }
  }
  return assets
}

const downloadTemplateInputAsset: NonNullable<
  ComfyDesktop2BridgeImplementation['downloadTemplateInputAsset']
> = async (templateId, assetId): Promise<ComfyTemplateInputAssetDownloadResult> => {
  ensureTemplateInputProgressHandler()
  templateInputInvokesInFlight += 1
  try {
    const result = await ipcRenderer.invoke('desktop2-download-template-input-asset', {
      templateId,
      assetId
    })
    if (result.status === 'accepted' || result.status === 'joined') {
      trackTemplateInputDownload({ templateId, assetId }, result.download, true)
    } else if (result.status === 'already-present') {
      emitTemplateInputProgress(
        {
          downloadId: alreadyPresentDownloadId(templateId, assetId),
          filename: result.filename,
          progress: 1,
          status: 'completed'
        },
        [{ templateId, assetId }]
      )
    }
    return result
  } finally {
    templateInputInvokesInFlight -= 1
    maybeRemoveTemplateInputProgressHandler()
  }
}

const onTemplateInputDownloadProgress: NonNullable<
  ComfyDesktop2BridgeImplementation['onTemplateInputDownloadProgress']
> = (callback) => {
  templateInputProgressCallbacks.add(callback)
  ensureTemplateInputProgressHandler()
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    templateInputProgressCallbacks.delete(callback)
    if (templateInputProgressCallbacks.size === 0 && templateInputInvokesInFlight === 0) {
      templateInputsByDownloadId.clear()
      terminalTemplateInputDownloadsById.clear()
    }
    maybeRemoveTemplateInputProgressHandler()
  }
}

const Auth: ComfyDesktop2AuthBridge = {
  getState: () => ipcRenderer.invoke('desktop2-auth:get-state'),
  getWorkspaceToken: (workspaceId) =>
    ipcRenderer.invoke('desktop2-auth:get-workspace-token', workspaceId),
  getPartnerNodeToken: (workspaceId) =>
    ipcRenderer.invoke('desktop2-auth:get-partner-node-token', workspaceId),
  requestSignIn: () => ipcRenderer.invoke('desktop2-auth:request-sign-in'),
  signOut: () => ipcRenderer.invoke('desktop2-auth:sign-out'),
  switchWorkspace: (workspaceId) =>
    ipcRenderer.invoke('desktop2-auth:switch-workspace', workspaceId),
  onChanged: (callback) => {
    const handler = (_event: IpcRendererEvent, state: ComfyDesktop2AuthState) => callback(state)
    ipcRenderer.on('desktop2-auth:changed', handler)
    return () => ipcRenderer.removeListener('desktop2-auth:changed', handler)
  }
}

let installId: string | undefined

const bridge = {
  isRemote: (): boolean => ipcRenderer.sendSync('desktop2-is-remote') as boolean,
  getInstallId: (): string | undefined =>
    (installId ??= ipcRenderer.sendSync('desktop2-get-install-id') as string | undefined),
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
  getTemplateInputAssets,
  downloadTemplateInputAsset,
  onTemplateInputDownloadProgress,
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
  Terminal,
  Logs,
  Telemetry,
  Auth
} satisfies ComfyDesktop2BridgeImplementation

contextBridge.exposeInMainWorld('__comfyDesktop2', bridge)
