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

/**
 * Desktop's own Comfy account session, as the hosted local ComfyUI view sees it.
 * `disabled` means Desktop does not share its session with this view (ops flag
 * off, or the view is not a trusted loopback ComfyUI).
 */
export type ComfyDesktop2AuthState =
  | { status: 'disabled' }
  | { status: 'signed_out' }
  | {
      status: 'signed_in'
      /** Comfy user id (the access token's `sub`), not a Firebase uid. */
      userId: string
      email?: string
      workspaceId?: string
    }

export type ComfyDesktop2BillingHandoffReceiver = 'billing_web' | 'platform'

export type ComfyDesktop2BillingHandoffIntent = 'top-up' | 'subscription'

export type ComfyDesktop2BillingHandoff =
  | { status: 'issued'; entryUrl: string }
  | { status: 'sign_in_again' }
  | { status: 'refused'; code?: string; message?: string }
  | { status: 'disabled' }

export interface ComfyDesktop2AuthBridge {
  getState(): Promise<ComfyDesktop2AuthState>
  /** The workspace credential, only for an exact workspace Desktop's session
   *  is scoped to; null when signed out, disabled, or the scope is missing,
   *  malformed or different. The refresh token never leaves Desktop. */
  getWorkspaceToken(workspaceId: string): Promise<string | null>
  /** The partner-node token for prompts in `workspaceId`, under the same rules
   *  as `getWorkspaceToken`. Desktop mints and renews it; null means use the
   *  workspace token. Absent on Desktop builds before it. */
  getPartnerNodeToken?(workspaceId: string): Promise<string | null>
  /** Runs Desktop's browser sign-in and resolves with the resulting state. */
  requestSignIn(): Promise<ComfyDesktop2AuthState>
  /** Signs Desktop out of its account (every view follows) and resolves with
   *  the resulting state; Desktop may keep the session if an install needs it. */
  signOut(): Promise<ComfyDesktop2AuthState>
  /** Re-scopes Desktop's session to `workspaceId` and resolves with the resulting
   *  state; every view follows. A view that is not signed in gets its current
   *  state back. Otherwise the switch may open browser consent: it does not for
   *  the grant's own workspace or one Desktop holds an unexpired token for,
   *  unless the grant has ended, and a request for a workspace Desktop is already
   *  switching to shares that switch's result. */
  switchWorkspace(workspaceId: string): Promise<ComfyDesktop2AuthState>
  /** Fires when Desktop signs in, signs out or switches workspace. */
  onChanged(callback: (state: ComfyDesktop2AuthState) => void): () => void
  /** Issues a billing handoff with Desktop's credential and resolves with only its https entry URL; `intent` picks the landing page and `amountCents` the top-up amount. Absent on older Desktop builds. */
  issueBillingHandoff?(
    workspaceId: string,
    receiver: ComfyDesktop2BillingHandoffReceiver,
    intent?: ComfyDesktop2BillingHandoffIntent,
    amountCents?: number
  ): Promise<ComfyDesktop2BillingHandoff>
}

/**
 * Desktop's own Comfy account session, as a Comfy page hosted in Desktop's
 * Apps view sees it. Desktop exposes it to that page as
 * `window.comfyDesktopAuth`. The page can read the session, hold the
 * workspace and partner-node credentials, and start a sign-in; it cannot sign
 * Desktop out or switch workspace.
 */
export type ComfyDesktopHostedAuthBridge = Required<
  Pick<
    ComfyDesktop2AuthBridge,
    'getState' | 'getWorkspaceToken' | 'getPartnerNodeToken' | 'requestSignIn' | 'onChanged'
  >
>

/** What a hosted page needs from the ComfyUI on this computer. */
export interface ComfyDesktopLocalRequirements {
  /** The oldest ComfyUI the page can run on, such as `0.41.0`. */
  minVersion?: string
}

/**
 * The ComfyUI on this computer that Desktop uses for a hosted page.
 * `running`: it answers now. `stopped`: one of the person's builds fits and
 * `startLocal` starts it. `unsupported`: no build here can run the page, and
 * `error` says why in words for the person.
 */
export interface ComfyDesktopLocalComfy {
  state: 'running' | 'stopped' | 'unsupported'
  /** True when it is one of the person's own builds. */
  own?: boolean
  name?: string
  version?: string
  /** The `client_id` Desktop listens with; updates for runs sent through `localFetch` arrive on `onLocalEvent`. */
  clientId?: string
  error?: string
}

/**
 * One call to that ComfyUI. Desktop forwards only what a run needs:
 * `GET /queue`, `GET /history/<run>`, `GET /view`, `GET /object_info/<node>`,
 * `POST /prompt`, `POST /upload/image`, `POST /queue` to take a run out, and
 * `POST /interrupt` to stop one. History, files, removal and stopping work
 * only for runs the page started through this bridge.
 */
export interface ComfyDesktopLocalRequest {
  method?: 'GET' | 'POST'
  path: string
  /** JSON text, or a file's bytes for `/upload/image`. */
  body?: string | Uint8Array
  /** The name to save an upload under. */
  fileName?: string
}

/** ComfyUI's answer, or status 403 for a call Desktop does not forward. */
export interface ComfyDesktopLocalAnswer {
  status: number
  contentType: string
  body: Uint8Array
}

/** A safetensors file on Hugging Face to save as `name` in the models folder `folder`. */
export interface ComfyDesktopLocalModel {
  url: string
  folder: string
  name: string
}

export interface ComfyDesktopLocalDownload {
  state: 'done' | 'failed' | 'cancelled'
  error?: string
}

/**
 * A model download's progress (`type: 'download'`, with `name`, `done` and
 * `total` bytes in `data`), or one ComfyUI socket message about a run the page
 * started (`execution_start`, `executing`, `progress`, `progress_state`,
 * `execution_success`, `execution_error`, `execution_interrupted`).
 */
export interface ComfyDesktopLocalEvent {
  type: string
  data?: Record<string, unknown>
}

/**
 * A ComfyUI on this computer, run by Desktop, for a Comfy page hosted in
 * Desktop's Apps view. Desktop exposes it to that page as
 * `window.comfyDesktopLocal`. The page builds and follows its own runs;
 * Desktop finds or starts the ComfyUI, forwards the page's calls to it and
 * downloads a model the page asks for.
 */
export interface ComfyDesktopHostedLocalBridge {
  getLocal(want?: ComfyDesktopLocalRequirements): Promise<ComfyDesktopLocalComfy>
  /** Starts the ComfyUI if it is stopped and resolves once it answers, or with the state and `error` if it could not start. */
  startLocal(want?: ComfyDesktopLocalRequirements): Promise<ComfyDesktopLocalComfy>
  /** Rejects when no ComfyUI is running to forward to. */
  localFetch(request: ComfyDesktopLocalRequest): Promise<ComfyDesktopLocalAnswer>
  /** Downloads into the running ComfyUI's models folder and resolves when the file is there. */
  localDownload(model: ComfyDesktopLocalModel): Promise<ComfyDesktopLocalDownload>
  onLocalEvent(callback: (event: ComfyDesktopLocalEvent) => void): () => void
}

/**
 * Usage events from a Comfy page hosted in Desktop's Apps view. Desktop
 * exposes it to that page as `window.comfyDesktopTelemetry` and sends an event
 * as `comfy.desktop.apps.<name>` only when the person allows telemetry.
 * Desktop takes `run_started` (`where`, and optionally `model`, `quality` and
 * `seconds`), `example_used` (`example`) and `open_in_comfyui` (`where`), each
 * with the app's catalog id in `app`. It drops any other event and any other
 * property, and sends `app_opened` itself.
 */
export interface ComfyDesktopHostedTelemetryBridge {
  track(name: string, props?: Record<string, string | number>): void
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
  /** Returns the per-installation id: a non-PII, stable-per-machine value
   *  (`SHA-256(machine_id + salt)`, see main/lib/deviceId). The hosted
   *  frontend sends it to cloud as the `X-Comfy-Install-Id` header so cloud
   *  can attribute requests to a Desktop install. Not an identity/secret.
   *  Undefined outside cloud-hosted pages or when the id is not
   *  machine-derived. Absent on Desktop builds predating it. */
  getInstallId?(): string | undefined
  openTerminal?: () => Promise<boolean>
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
