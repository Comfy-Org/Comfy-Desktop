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
}

export interface TerminalRestore {
  buffer: string[]
  size: { cols: number; rows: number }
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
  | { status: 'pending' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; userId: string }

/** Desktop's account session as the hosted view may see it. Never carries a token. */
export type ComfyDesktop2AuthState =
  /** Desktop does not hand its session to this view (feature off or view not trusted). */
  | { status: 'disabled' }
  | { status: 'signed_out' }
  | {
      status: 'signed_in'
      /** Comfy user id (the access token's `sub`), not a Firebase uid. */
      userId: string
      email?: string
      /** Only set when the token says so; absent means unknown, not false. */
      emailVerified?: boolean
      workspaceId?: string
    }

/** Why the hosted view's request with a Desktop access token was refused. */
export type ComfyDesktop2AuthRefusal = 'unauthorized' | 'sso_required'

export interface ComfyDesktop2AuthBridge {
  getState(): Promise<ComfyDesktop2AuthState>
  /** A fresh access token, refreshed by Desktop; null when signed out or disabled.
   *  The refresh token never leaves Desktop. */
  getAccessToken(): Promise<string | null>
  /** Starts Desktop's own browser sign-in. Resolves with the resulting state. */
  requestSignIn(): Promise<ComfyDesktop2AuthState>
  /** Reports a refusal of `accessToken`. Desktop refreshes it, or signs out
   *  everywhere when the grant is gone. Resolves with the resulting state. */
  reportRefusal(
    accessToken: string,
    reason: ComfyDesktop2AuthRefusal
  ): Promise<ComfyDesktop2AuthState>
  /** Fires on sign-in, sign-out and workspace switch. */
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
  pauseDownload?: (url: string) => Promise<boolean>
  resumeDownload?: (url: string) => Promise<boolean>
  cancelDownload?: (url: string) => Promise<boolean>
  onDownloadProgress?: (callback: (data: ComfyDownloadProgress) => void) => () => void
  reportTheme?: (bg: string, text: string) => void
  Terminal?: ComfyDesktop2TerminalBridge
  Logs?: ComfyDesktop2LogsBridge
  Telemetry?: ComfyDesktop2TelemetryBridge
  /** Desktop's account session. Optional: older desktop builds do not have it. */
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
