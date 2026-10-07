export interface ComfyDownloadProgress {
  /** Stable per-job identifier assigned by the desktop app. The download
   *  controls accept it in place of the URL. Optional: older desktop
   *  versions do not send it. */
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
  /**
   * The template inputs this transfer serves, named by the host on every
   * event. A retry mints a new job id, and a renderer that dropped the old
   * mapping has no way back to it; naming the inputs here removes the need
   * to correlate by id at all.
   */
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
  /** Every template asset currently sharing this managed download job. */
  templateInputs: ComfyTemplateInputReference[]
}
export interface ComfyTemplateInputAsset {
  /** Opaque, template-scoped identifier accepted by `downloadTemplateInputAsset`. */
  assetId: string
  filename: string
  mediaType: 'image' | 'video' | 'audio'
  /** Desktop-resolved public URL for previewing this declared template asset. */
  previewUrl: string
  availability: 'present' | 'missing' | 'unknown'
  /** Present when this exact asset destination already has a managed job. */
  activeDownload?: ComfyTemplateInputAssetDownload
}
export type ComfyTemplateInputAssetDownloadResult =
  | {
      status: 'already-present'
      /**
       * No job exists for a file that is already on disk, so nothing would
       * report it. Naming it lets the host emit one terminal progress event,
       * which is the only channel a renderer watches.
       */
      filename: string
    }
  | {
      status: 'accepted' | 'joined'
      /** Admission snapshot seeds UI state even if the first IPC event raced ahead. */
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
/**
 * Desktop's own Comfy account session, as the hosted local ComfyUI view sees it.
 * `disabled` means Desktop does not share its session with this view (ops flag
 * off, or the view is not a trusted loopback ComfyUI).
 */
export type ComfyDesktop2AuthState =
  | {
      status: 'disabled'
    }
  | {
      status: 'signed_out'
    }
  | {
      status: 'signed_in'
      /** Comfy user id (the access token's `sub`), not a Firebase uid. */
      userId: string
      email?: string
      workspaceId?: string
    }
export interface ComfyDesktop2AuthBridge {
  getState(): Promise<ComfyDesktop2AuthState>
  /** A current access token (Desktop refreshes it when due), or null when
   *  signed out, disabled, or scoped to a workspace other than `workspaceId`.
   *  The refresh token never leaves Desktop. */
  getAccessToken(workspaceId?: string): Promise<string | null>
  /** Runs Desktop's browser sign-in and resolves with the resulting state. */
  requestSignIn(): Promise<ComfyDesktop2AuthState>
  /** Signs Desktop out of its account (every view follows) and resolves with
   *  the resulting state; Desktop may keep the session if an install needs it. */
  signOut(): Promise<ComfyDesktop2AuthState>
  /** Fires when Desktop signs in, signs out or switches workspace. */
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
  /** Capture a hosted-frontend exception through Desktop's privacy and release-context boundary. */
  captureException?(error: ComfyDesktop2Error, properties?: ComfyDesktop2TelemetryProperties): void
  /** Report the hosted view's complete Firebase state for process-wide consensus. */
  reportFirebaseAuthState?(state: ComfyDesktop2FirebaseAuthState): void
}
export interface ComfyDesktop2Bridge {
  /** Reports whether the backend server is cloud/remote, not the user's location.
   *  Optional: desktop builds predating it are still in the wild. */
  isRemote?(): boolean
  openTerminal?: () => Promise<boolean>
  openMcpSetup?: () => Promise<boolean>
  /** Opens a model provider access page in the hosted frontend's browser session.
   *  Resolves `true` when the host has taken ownership of the request.
   *  On `false` or rejection the frontend falls back to opening a new tab. */
  openModelAccessPage?: (url: string) => Promise<boolean>
  downloadModel?: (url: string, filename: string, directory: string) => Promise<boolean>
  downloadAsset?: (url: string, filename: string, authToken?: string) => Promise<boolean>
  /** Resolve only assets declared by this template. `null` means Desktop cannot
   *  authorize the caller or resolve the metadata; `[]` means the resolved
   *  template declares none. */
  getTemplateInputAssets?: (templateId: string) => Promise<ComfyTemplateInputAsset[] | null>
  /** Start or join the managed download for one declared template asset. */
  downloadTemplateInputAsset?: (
    templateId: string,
    assetId: string
  ) => Promise<ComfyTemplateInputAssetDownloadResult>
  /** Download events decorated with the template asset identities that own the job. */
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
  /** Absent on Desktop builds older than this bridge. */
  Auth?: ComfyDesktop2AuthBridge
}
/**
 * The `-?` mapper intentionally requires every top-level bridge member.
 * Adding an optional top-level member to `ComfyDesktop2Bridge` is therefore a
 * breaking change for implementations of this type. Optional members of nested
 * bridge types remain optional because the mapper is not recursive.
 */
export type ComfyDesktop2BridgeImplementation = {
  [K in keyof ComfyDesktop2Bridge]-?: NonNullable<ComfyDesktop2Bridge[K]>
}
