import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
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

/**
 * Stable per asset so a renderer that de-duplicates terminal events by id
 * sees one completion per file, however often a template is reopened.
 */
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

/**
 * A download invoke can resolve after its last subscriber has gone. Until it
 * does, the handler has to stay attached and the identity maps have to keep
 * their entries, or a transfer that finishes in that window loses its
 * terminal event and the handler it re-attaches is never released.
 */
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
    // Prefer what the host named: a retry mints a new job id, and the mapping
    // for the old one was dropped on its terminal event. The map remains for
    // desktop builds that do not send `templateInputs`.
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
      // No job will ever report this file, so say so once here. Renderers
      // watch this stream and nothing else, and a file that arrived between
      // the availability answer and this call still needs rebinding.
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
      // A future detail view reconstructs active ownership from its metadata
      // snapshot. Do not retain identities for a renderer with no consumers.
      templateInputsByDownloadId.clear()
      terminalTemplateInputDownloadsById.clear()
    }
    maybeRemoveTemplateInputProgressHandler()
  }
}

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
  openMcpSetup,
  Terminal,
  Logs,
  Telemetry
} satisfies ComfyDesktop2BridgeImplementation

contextBridge.exposeInMainWorld('__comfyDesktop2', bridge)
