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
  { status: 'pending' } | { status: 'signed_out' } | { status: 'signed_in'; userId: string }

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
  /**
   * The build the person picked to run on, an id from `localBuilds`. Desktop
   * uses it when it is installed and new enough, and otherwise chooses as if
   * none was named: a running build first, then one that is starting, then
   * the one used last. The answer names the build Desktop chose.
   */
  build?: string
}

/**
 * The ComfyUI on this computer that Desktop uses for a hosted page.
 * `running`: it answers now. `stopped`: one of the person's builds fits and
 * `startLocal` starts it. `installing`: the person's first build is still
 * installing; `localDownload` already works, and `startLocal` waits for the
 * install to finish, then starts it. `unsupported`: no build here can run the
 * page, and `error` says why in words for the person.
 */
export interface ComfyDesktopLocalComfy {
  state: 'running' | 'stopped' | 'installing' | 'unsupported'
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
 * A workflow a hosted page asks Desktop to open in a ComfyUI window.
 * `prompt` is the API-format graph: an object of nodes that each have a
 * `class_type` and `inputs`, at most 500 nodes and 1 MB. `where: 'local'`
 * opens it in the build the page runs on, or in `build` (an id from
 * `localBuilds`); `where: 'cloud'` opens it in the person's Comfy Cloud.
 * `name` titles the workflow tab.
 */
export interface ComfyDesktopOpenInComfyRequest {
  prompt: Record<string, unknown>
  where: 'local' | 'cloud'
  name: string
  build?: string
}

/** Whether the workflow opened, and if not, why in words for the person. */
export type ComfyDesktopOpenInComfy = { opened: true } | { opened: false; error: string }

/** One of the person's ComfyUI builds on this computer. */
export interface ComfyDesktopLocalBuild {
  id: string
  name: string
  /** Its ComfyUI version, such as `0.42.1`, when Desktop knows it. Absent on Desktop builds that predate it. */
  version?: string
  /** True when it is running now. Absent on Desktop builds that predate it. */
  running?: boolean
}

/**
 * A ComfyUI on this computer, run by Desktop, for a Comfy page hosted in
 * Desktop's Apps view. Desktop exposes it to that page as
 * `window.comfyDesktopLocal`. The page builds and follows its own runs;
 * Desktop finds or starts the ComfyUI, forwards the page's calls to it,
 * downloads a model the page asks for and opens a run's workflow in a ComfyUI
 * window.
 */
export interface ComfyDesktopHostedLocalBridge {
  getLocal(want?: ComfyDesktopLocalRequirements): Promise<ComfyDesktopLocalComfy>
  /** Starts the ComfyUI if it is stopped, after its install finishes if it is installing, and resolves once it answers, or with the state and `error` if it could not start. */
  startLocal(want?: ComfyDesktopLocalRequirements): Promise<ComfyDesktopLocalComfy>
  /** Rejects when no ComfyUI is running to forward to. */
  localFetch(request: ComfyDesktopLocalRequest): Promise<ComfyDesktopLocalAnswer>
  /** Downloads into the models folder of the build `getLocal` named, running, stopped or still installing, and resolves when the file is there. A build that keeps its models inside its own folder gets them once its install finishes. */
  localDownload(model: ComfyDesktopLocalModel): Promise<ComfyDesktopLocalDownload>
  onLocalEvent(callback: (event: ComfyDesktopLocalEvent) => void): () => void
  /**
   * Opens the workflow in a ComfyUI window in Desktop, starting the build or
   * showing its window first if needed, and resolves once ComfyUI has loaded
   * it. Absent on Desktop builds that predate it.
   */
  openInComfy?(request: ComfyDesktopOpenInComfyRequest): Promise<ComfyDesktopOpenInComfy>
  /** The person's ComfyUI builds on this computer. Absent on Desktop builds that predate it. */
  localBuilds?(): Promise<ComfyDesktopLocalBuild[]>
}

/**
 * Usage events from a Comfy page hosted in Desktop's Apps view. Desktop
 * exposes it to that page as `window.comfyDesktopTelemetry` and sends an event
 * as `comfy.desktop.apps.<name>` only when the person allows telemetry.
 * `name` matches `^[a-z][a-z0-9_]{0,47}$`. Desktop sends these app events
 * itself and refuses them from a page: `app_opened`, `app_page_failed`,
 * `run_finished` (how a run on this computer ended) and `setup` (Desktop
 * installing or starting the ComfyUI an app runs on); it refuses `error` too.
 * Desktop sends at most 60 events a minute for one app and 1,000 page events
 * a session, and drops the rest. Desktop keeps at most 16
 * properties, each named `^[a-z][a-z0-9_]{0,31}$` with a boolean, a finite
 * number or a slug of at most 64 characters (`^[a-z0-9][a-z0-9._-]{0,63}$`),
 * and drops anything else. Desktop sets `app_id` itself, to the app whose
 * page it loaded in that view; an `app` or `app_id` from the page is ignored,
 * and an event sent while the view loads another app is dropped.
 */
export interface ComfyDesktopHostedTelemetryBridge {
  track(name: string, props?: Record<string, string | number | boolean>): void
}

/**
 * A file ComfyUI saved in its output folder, named as a run's history names
 * it. `filename` has no folder in it, and `subfolder` is relative, with no
 * `.` or `..` parts. Only `type: 'output'` is kept.
 */
export interface ComfyDesktopOutputFile {
  filename: string
  subfolder?: string
  type: 'output'
}

/**
 * One output a hosted page asks Desktop to show. `mimeType` is one of
 * `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`,
 * `video/mp4`, `video/webm`, `video/quicktime`, `audio/mpeg`, `audio/mp4`,
 * `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/webm`, `audio/flac` or
 * `audio/aac`. `name` is at most 200 characters. Desktop keeps the first 8
 * `tags`, each cut to 40 characters, and offers Open workflow only when
 * `workflow` is true. Desktop refuses a `name`, and drops a tag, that has
 * control, bidirectional or zero-width formatting characters in the part it
 * keeps.
 *
 * `savedOn` says where the output is saved. For `cloud`, Desktop shows
 * "Saved in Comfy Cloud assets" and View in Assets, which opens Desktop's
 * Assets page on Comfy Cloud with the newest file of that `name` open. For
 * `computer`, Desktop shows the folder it is saved in and Show in folder.
 */
export interface ComfyDesktopOutput {
  name: string
  mimeType: string
  bytes: Uint8Array
  tags?: string[]
  workflow?: boolean
  savedOn?: 'cloud' | 'computer'
  /**
   * For `computer` without `comfyFile`: the absolute path of the folder the
   * page saved the output in. Desktop only shows it, and Show in folder comes
   * back to the page on `onOutputAction`.
   */
  folder?: string
  /**
   * For `computer`: the file ComfyUI saved for this output. Desktop looks for
   * it in the output folder of the build the page runs on, and uses it only
   * when it has exactly the output's `bytes`. Desktop then shows its folder
   * and shows the file in its folder itself; otherwise it shows no folder.
   */
  comfyFile?: ComfyDesktopOutputFile
}

/** At most 40 outputs and 100 MB of bytes in all, and the index of the one to show first. */
export interface ComfyDesktopShowOutputRequest {
  items: ComfyDesktopOutput[]
  index: number
}

/**
 * What the person picked in Desktop's output dialog for the output at `index`
 * of the page's last `showOutput` request: download it, open its workflow, or
 * show it in its `folder`. Desktop does not send `show-in-folder` for an
 * output whose `comfyFile` it found, because it shows that file itself.
 */
export interface ComfyDesktopOutputAction {
  action: 'download' | 'open-workflow' | 'show-in-folder'
  index: number
}

/**
 * Desktop's output dialog, for a Comfy page hosted in Desktop's Apps view.
 * Desktop exposes it to that page as `window.comfyDesktopOutputs`. Desktop
 * shows the outputs over the Apps view and does not save or open anything
 * itself: Download, Open workflow and Show in folder come back to the page on
 * `onOutputAction`, only while the page that showed the outputs is still the
 * app's loaded page. Desktop itself only shows a found `comfyFile` in its
 * folder, and opens the Assets page for View in Assets.
 */
export interface ComfyDesktopHostedOutputsBridge {
  /** Resolves true once Desktop shows the outputs, and false when the app is not on screen or a newer request from the page replaced this one. Rejects a request Desktop cannot show. */
  showOutput(request: ComfyDesktopShowOutputRequest): Promise<boolean>
  onOutputAction(callback: (action: ComfyDesktopOutputAction) => void): () => void
}

/** A kind of picture an app input takes. Desktop tells it by the file's extension. */
export type ComfyDesktopAssetKind = 'image' | 'video'

/** Where a run goes: `local` is This computer, `cloud` is Comfy Cloud. */
export type ComfyDesktopAssetWhere = 'local' | 'cloud'

/**
 * A picture Desktop holds for a page, named by an opaque `ref` that works
 * only in the page document that received it. The page never learns a path.
 */
export interface ComfyDesktopAssetRef {
  ref: string
  /** The file name to show, such as `cutout_00001_.png`. */
  name: string
  kind: ComfyDesktopAssetKind
  where: ComfyDesktopAssetWhere
  /** The app that made it, the `<app>` in `output/apps/<app>/...`, or null. */
  app: string | null
  /** Milliseconds since the epoch: the file's modified time, or the Cloud asset's creation time. */
  createdAt: number
  /** Its size in bytes. */
  size: number
  /** A small `data:` URL whose long side is at most 256 px, or null when none is cheap to make. */
  thumb: string | null
}

/**
 * Why Desktop could not answer: `missing` (the file or reference is gone),
 * `elsewhere` (the reference is for the other place, has no run value
 * there, or Desktop could not reach it), `too-large`, `wrong-kind`,
 * `not-a-file` (a folder),
 * `no-path` (a pasted or made-up file with no path on disk) or `signed-out`.
 */
export type ComfyDesktopAssetError =
  'missing' | 'elsewhere' | 'too-large' | 'wrong-kind' | 'not-a-file' | 'no-path' | 'signed-out'

export interface ComfyDesktopAssetFailure {
  error: ComfyDesktopAssetError
}

/** `limit` is 12 when absent, and at most 48. */
export interface ComfyDesktopAssetRecentRequest {
  kinds: ComfyDesktopAssetKind[]
  where: ComfyDesktopAssetWhere
  limit?: number
}

export interface ComfyDesktopAssetFileRequest {
  kinds: ComfyDesktopAssetKind[]
}

export interface ComfyDesktopAssetValueRequest {
  where: ComfyDesktopAssetWhere
}

export interface ComfyDesktopAssetBytes {
  bytes: ArrayBuffer
  mime: string
}

/** What to put in `LoadImage.image` or `LoadVideo.file`. */
export interface ComfyDesktopAssetValue {
  value: string
}

/**
 * The person's pictures for the inputs of a Comfy page hosted in Desktop's
 * Apps view. Desktop exposes it to that page as `window.comfyDesktopAssets`.
 * The page gets references, never paths, and asks Desktop for the run value
 * of a reference when a run starts. Absent on Desktop builds that predate it.
 */
export interface ComfyDesktopHostedAssetsBridge {
  /**
   * Newest first. `local`: the files under `output/apps/` of the build the
   * page's local runs go to, which is the shared output folder by default, and
   * no other output files. `cloud`: the signed-in workspace's Comfy Cloud
   * outputs, as Desktop's Assets page lists them; empty when signed out.
   */
  recent(request: ComfyDesktopAssetRecentRequest): Promise<ComfyDesktopAssetRef[]>
  /**
   * A file the person dropped or chose. Only its path reaches Desktop, which
   * takes it when it is a regular file (after following links), of a kind in
   * `kinds` by its extension, and at most 2 GiB. A file with no path on disk
   * answers `no-path`, and the page uploads it as before. The answer's
   * `thumb` is null, since the page already has the file to show.
   */
  fromFile(
    file: File,
    request: ComfyDesktopAssetFileRequest
  ): Promise<ComfyDesktopAssetRef | ComfyDesktopAssetFailure>
  /** The bytes, for the page's preview and its saved run. Above 512 MiB answers `too-large`. Desktop fetches a Cloud reference with its own sign-in. */
  read(ref: string): Promise<ComfyDesktopAssetBytes | ComfyDesktopAssetFailure>
  /**
   * The value for a run going to `where`. A file on this computer, for a run
   * on This computer: inside the build's output folder
   * `<path/with/forward/slashes> [output]`, inside its input folder
   * `<path> [input]`, and anywhere else `desktop/<hash>.<ext> [input]` after
   * Desktop copies it once into `input/desktop/`, reusing an earlier copy. A
   * Cloud output, for a run on Comfy Cloud: `<loader path> [output]`. A
   * reference for the other place answers `elsewhere`, and the page uploads
   * the bytes from `read` as before. A file that is gone answers `missing`.
   */
  valueFor(
    ref: string,
    request: ComfyDesktopAssetValueRequest
  ): Promise<ComfyDesktopAssetValue | ComfyDesktopAssetFailure>
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
  /** Live model jobs (pending, downloading or paused) for the caller's installation,
   *  in the `onDownloadProgress` shape; the caller then receives later events for
   *  those jobs, not for jobs started afterwards by Desktop or another view.
   *  Register `onDownloadProgress` first: earlier events are not replayed.
   *  Absent on Desktop builds predating it. */
  listModelDownloads?: () => Promise<ComfyDownloadProgress[]>
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
