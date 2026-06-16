import type { InstallationRecord } from '../installations'
import type { Cache } from '../lib/cache'
import type { DownloadProgress } from '../lib/download'
import type { ExtractProgress } from '../lib/extract'

export interface SourceField {
  id: string
  label: string
  type: 'text' | 'select'
  defaultValue?: string
  action?: { label: string }
  errorTarget?: string
  renderAs?: 'cards'
}

export interface FieldOption {
  value: string
  label: string
  description?: string
  recommended?: boolean
  data?: Record<string, unknown>
}

export interface LaunchCommand {
  cmd?: string
  args?: string[]
  cwd?: string
  port?: number
  remote?: boolean
  url?: string
  host?: string
  env?: NodeJS.ProcessEnv
  /** When true, show the spawned process window (disables windowsHide). */
  showWindow?: boolean
  /** When true, skip port conflict detection and port readiness waiting.
   *  The session is registered immediately after spawning. */
  skipPortWait?: boolean
  /** Skip injecting shared model/input/output args (external apps without ComfyUI flags). */
  skipSharedPaths?: boolean
}

export interface InstallTools {
  sendProgress: (step: string, data: { percent: number; status: string }) => void
  download: (url: string, dest: string, onProgress: ((p: DownloadProgress) => void) | null, options?: { signal?: AbortSignal; expectedSize?: number }) => Promise<string>
  cache: Cache
  extract: (archivePath: string, dest: string, onProgress?: ((p: ExtractProgress) => void) | null, options?: { signal?: AbortSignal }) => Promise<void>
  signal?: AbortSignal
}

export interface ActionTools {
  update: (data: Record<string, unknown>) => Promise<void>
  sendProgress: (step: string, data: Record<string, unknown>) => void
  sendOutput: (text: string) => void
  signal?: AbortSignal
}

export interface PostInstallTools {
  sendProgress: (step: string, data: { percent: number; status: string }) => void
  update: (data: Record<string, unknown>) => Promise<void>
  signal?: AbortSignal
}

export interface ActionResult {
  ok: boolean
  navigate?: string
  message?: string
}

export interface StatusTag {
  label: string
  style: string
  /** Raw version the tag refers to, so surfaces like the title-bar update pill can
   *  show "Update v1.2.3" without re-parsing the localised `label`. */
  version?: string
}

export interface InstallStep {
  phase: string
  label: string
}

/** How the interactive Console should route `pip`: `exe args… <userArgs>`
 *  (e.g. the bundled `uv pip …`, or a portable build's `python -s -m pip …`). */
export interface TerminalPipCommand {
  exe: string
  args: string[]
}

/**
 * Describes how the interactive Console should set up an install's shell.
 * A source returns this so the terminal activates the *right* environment
 * instead of assuming the standalone `ComfyUI/.venv` + bundled-uv layout.
 */
export interface TerminalEnv {
  /** Directory the shell should open in — the ComfyUI code folder (where
   *  `main.py` lives), so the terminal lands on the repo regardless of how the
   *  install is packaged. Falls back to the install path when unset or missing. */
  cwd?: string
  /** venv dir to activate: sets VIRTUAL_ENV, prepends its Scripts/bin to PATH,
   *  and shows the venv prompt. Omit when there is no venv to activate. */
  venvDir?: string
  /** Dirs to prepend to PATH when there is no venv (e.g. a portable build's
   *  embedded `python_embeded` + its `Scripts`). */
  pathPrepends?: string[]
  /** Prompt label shown in the activated shell; defaults to the venvDir basename. */
  promptName?: string
  /** Routes the `pip` alias/function through this command; omit to leave pip
   *  as the activated environment provides it. */
  pip?: TerminalPipCommand
}

export interface SourcePlugin {
  id: string
  label: string
  description?: string
  category: string
  hasConsole?: boolean
  skipInstall?: boolean
  platforms?: readonly string[]
  hidden?: boolean
  fields: readonly SourceField[]
  defaultLaunchArgs?: string
  installSteps?: readonly InstallStep[]

  getDefaults?(): Record<string, unknown>
  getStatusTag?(installation: InstallationRecord): StatusTag | undefined
  buildInstallation(selections: Record<string, FieldOption | undefined>): Record<string, unknown>
  getListPreview?(installation: InstallationRecord): string | null
  getLaunchCommand(installation: InstallationRecord): LaunchCommand | null
  /**
   * Resolve how the interactive Console should activate this install's shell.
   * Return `null` to use the standalone default (`ComfyUI/.venv` + bundled uv).
   * Sources with a different layout (git venv, portable embedded python) must
   * implement this so the terminal doesn't reference a nonexistent standalone-env.
   */
  getTerminalEnv?(installation: InstallationRecord): TerminalEnv | null
  getListActions?(installation: InstallationRecord): Record<string, unknown>[]
  getDetailSections(installation: InstallationRecord): Record<string, unknown>[]
  install?(installation: InstallationRecord, tools: InstallTools): Promise<void>
  postInstall?(installation: InstallationRecord, tools: PostInstallTools): Promise<void>
  probeInstallation(dirPath: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  handleAction(
    actionId: string,
    installation: InstallationRecord,
    actionData: Record<string, unknown> | undefined,
    tools: ActionTools
  ): Promise<ActionResult>
  getFieldOptions?(
    fieldId: string,
    selections: Record<string, FieldOption | undefined>,
    context: Record<string, unknown>
  ): Promise<FieldOption[]>
  /**
   * Source-specific post-processing after `performCopy` copies the wrapper tree to
   * `destPath`: rewrite venv path metadata (pyvenv.cfg, shebangs) and pull in files
   * outside `inst.installPath` (e.g. an adopted install's legacy venv under `adoptedBaseDir`).
   */
  fixupCopy?(
    inst: InstallationRecord,
    destPath: string,
    sendProgress: (phase: string, detail: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ): Promise<void>
}
