export interface ComfyDownloadProgress {
  id?: string
  url: string
  filename: string
  directory?: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
  isImage?: boolean
  templateInputs?: ComfyTemplateInputReference[]
}
export interface ComfyTemplateInputReference {
  templateId: string
  assetId: string
}
export interface ComfyTemplateInputAssetDownload {
  downloadId: string
  filename: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  status: ComfyDownloadProgress['status']
  error?: string
}
export interface ComfyTemplateInputDownloadProgress extends ComfyTemplateInputAssetDownload {
  templateInputs: ComfyTemplateInputReference[]
}
export interface ComfyTemplateInputAsset {
  assetId: string
  filename: string
  mediaType: 'image' | 'video' | 'audio'
  previewUrl: string
  availability: 'present' | 'missing' | 'unknown'
  activeDownload?: ComfyTemplateInputAssetDownload
}
export type ComfyTemplateInputAssetDownloadResult =
  | {
      status: 'already-present'
      filename: string
    }
  | {
      status: 'accepted' | 'joined'
      download: ComfyTemplateInputAssetDownload
    }
  | {
      status: 'not-started'
      reason: 'invalid-request' | 'not-declared' | 'unavailable'
    }
export interface TerminalRestore {
  buffer: string[]
  size: {
    cols: number
    rows: number
  }
  exited: boolean
}
export interface LogsRestore {
  installationId: string
  buffer: string[]
}
export interface LogsOutputMsg {
  installationId: string
  text: string
}
export type ComfyDesktop2TelemetryValue = string | number | boolean | null
export type ComfyDesktop2TelemetryProperties = Record<
  string,
  ComfyDesktop2TelemetryValue | ComfyDesktop2TelemetryValue[]
>
export interface ComfyDesktop2Error {
  message: string
  stack?: string
}
export type ComfyDesktop2FirebaseAuthState =
  | {
      status: 'pending'
    }
  | {
      status: 'signed_out'
    }
  | {
      status: 'signed_in'
      userId: string
    }
export type ComfyDesktop2AuthState =
  | {
      status: 'disabled'
    }
  | {
      status: 'signed_out'
    }
  | {
      status: 'signed_in'
      userId: string
      email?: string
      workspaceId?: string
    }
export interface ComfyDesktop2AuthBridge {
  getState(): Promise<ComfyDesktop2AuthState>
  getWorkspaceToken(workspaceId: string): Promise<string | null>
  requestSignIn(): Promise<ComfyDesktop2AuthState>
  signOut(): Promise<ComfyDesktop2AuthState>
  switchWorkspace(workspaceId: string): Promise<ComfyDesktop2AuthState>
  onChanged(callback: (state: ComfyDesktop2AuthState) => void): () => void
}
export interface ComfyDesktop2TerminalBridge {
  subscribe(installationId?: string): Promise<TerminalRestore>
  unsubscribe(installationId?: string): Promise<void>
  write(data: string, installationId?: string): Promise<void>
  resize(cols: number, rows: number, installationId?: string): Promise<void>
  restart(installationId?: string): Promise<TerminalRestore>
  openPopout(): Promise<void>
  onOutput(callback: (data: string) => void): () => void
  onExited(callback: () => void): () => void
}
export interface ComfyDesktop2LogsBridge {
  subscribe(installationId?: string): Promise<LogsRestore>
  unsubscribe(installationId?: string): Promise<void>
  openPopout(): Promise<void>
  onOutput(callback: (msg: LogsOutputMsg) => void): () => void
}
export interface ComfyDesktop2TelemetryBridge {
  capture(event: string, properties?: ComfyDesktop2TelemetryProperties): void
  captureException?(error: ComfyDesktop2Error, properties?: ComfyDesktop2TelemetryProperties): void
  reportFirebaseAuthState?(state: ComfyDesktop2FirebaseAuthState): void
}
export interface ComfyDesktop2Bridge {
  isRemote?(): boolean
  getInstallId?(): string | undefined
  openTerminal?: () => Promise<boolean>
  openModelAccessPage?: (url: string) => Promise<boolean>
  downloadModel?: (url: string, filename: string, directory: string) => Promise<boolean>
  downloadAsset?: (url: string, filename: string, authToken?: string) => Promise<boolean>
  getTemplateInputAssets?: (templateId: string) => Promise<ComfyTemplateInputAsset[] | null>
  downloadTemplateInputAsset?: (
    templateId: string,
    assetId: string
  ) => Promise<ComfyTemplateInputAssetDownloadResult>
  onTemplateInputDownloadProgress?: (
    callback: (data: ComfyTemplateInputDownloadProgress) => void
  ) => () => void
  pauseDownload?: (url: string) => Promise<boolean>
  resumeDownload?: (url: string) => Promise<boolean>
  cancelDownload?: (url: string) => Promise<boolean>
  onDownloadProgress?: (callback: (data: ComfyDownloadProgress) => void) => () => void
  reportTheme?: (bg: string, text: string) => void
  Terminal?: ComfyDesktop2TerminalBridge
  Logs?: ComfyDesktop2LogsBridge
  Telemetry?: ComfyDesktop2TelemetryBridge
  Auth?: ComfyDesktop2AuthBridge
}
export type ComfyDesktop2BridgeImplementation = {
  [K in keyof ComfyDesktop2Bridge]-?: NonNullable<ComfyDesktop2Bridge[K]>
}
