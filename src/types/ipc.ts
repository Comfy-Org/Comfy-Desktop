import type { FirstUseMode } from '../shared/firstUseMode'
import type { GpuTier } from '../shared/gpuTier'
export type { FirstUseMode }

import type { AuthStatus, Workspace } from '../main/cloud/types'
export type { AuthStatus, Workspace }

import type { BetaActivationNotice } from '../main/lib/betaActivationNotice'
export type { BetaActivationNotice }

export interface CoachmarkBeakPayload {
  beakFraction: number
  cardCentreInView: number | null
}

export type DevPlatformBuildState =
  | 'installable'
  | 'no-build'
  | 'platform-mismatch'
  | 'needs-desktop-update'
  | 'installed'
  | 'update-available'

export interface DevPlatformBuildTarget {
  artifactId: string
  releaseVersion: number
  os: 'linux' | 'windows' | 'mac'
  gpu: 'nvidia' | 'amd' | 'cpu' | 'mps'
  accelVariant: string
  recommended: boolean
}

export interface DevPlatformBuild {
  id: string
  name: string
  description?: string
  createdBy?: string
  creatorName?: string
  version?: string
  comfyuiVersion?: string
  finishedAt?: string
  sizeBytes?: number
  numModels?: number
  numAllowedModels?: number
  numCustomNodes?: number
  updatedAt?: string
  state: DevPlatformBuildState
  blockedReason?: string
  targetOs?: string[]
  releaseTargets?: DevPlatformBuildTarget[]
  minDesktopVersion?: string
  installedVersion?: number
}

export interface InstallBuildResult {
  ok: boolean
  message?: string
  entry?: { id: string; name: string }
}

export interface InstallBuildRequest {
  buildId: string
  artifactId?: string
  releaseVersion?: number
  name?: string
  installRoot?: string
}

export interface PromoteLocalInstanceResult {
  ok: boolean
  message?: string
}

export type Unsubscribe = () => void

export type Theme = 'system' | 'dark' | 'light'
export type ResolvedTheme = Exclude<Theme, 'system'>

export interface VersionStatRow {
  id: string
  label: string
  value: string
  title?: string
  highlight?: boolean
}

export interface VersionStatsValue {
  headline: string
  headlineHighlight?: boolean
  badge?: string | null
  badgeTone?: 'current' | 'update'
  rows: VersionStatRow[]
}

export type CloudUserTier = 'free' | 'paid' | 'unknown'

export interface Installation {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  workspaceId?: string
  version?: string
  statusTag?: { style: string; label: string; version?: string; detail?: string }
  seen?: boolean
  listPreview?: string
  launchMode?: string
  launchArgs?: string
  hasConsole?: boolean
  installPath?: string
  status?: string
  lastLaunchedAt?: number
  lastLaunchedAtByCategory?: Record<string, number>
  [key: string]: unknown
}

export type DashboardPage = 'home' | 'assets' | 'chooser' | 'benchmarks' | 'performance-test'

export interface CatalogWorkflow {
  id: string
  title: string
  description: string
  thumbnailUrl: string | null
}

export type AssetKind = 'image' | 'video' | 'audio' | '3d'

export interface AssetSummary {
  id: string
  name: string
  kind: AssetKind | null
  sizeBytes: number | null
  createdAt: string | null
  mimeType: string | null
  tags: string[]
  previewUrl: string | null
}

export interface BuildStorageSnapshot {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: { path: string; isPrimary: boolean }[]
  modelsSystemDefault: string
}

export interface RunningInstance {
  installationId: string
  installationName: string
  port?: number
  url?: string
  mode: string
  startedAt?: number
  bootTimeMs?: number
  portRetries?: number
  rebootRetries?: number
}

export interface Source {
  id: string
  label: string
  category?: string
  description?: string
  fields: SourceField[]
  hideInstallPath?: boolean
  skipInstall?: boolean
}

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

export interface DetailSection {
  title?: string
  description?: string
  collapsed?: boolean
  pinBottom?: boolean
  tab?: string
  items?: DetailItem[]
  fields?: DetailField[]
  actions?: ActionDef[]
}

export interface DetailItem {
  label: string
  active?: boolean
  tag?: string
  actions?: ActionDef[]
}

export interface DetailOptionGroup {
  id: string
  label: string
  description?: string
}

export interface DetailFieldOption {
  value: string
  label: string
  description?: string
  recommended?: boolean
  groupPath?: DetailOptionGroup[]
  data?: Record<string, unknown>
}

export interface BetaArgView {
  arg: string
  name: string | null
}

export interface CoreBetaArgs {
  timing: 'session' | 'next-launch'
  args: BetaArgView[]
}

export interface ComfyArgDef {
  name: string
  flag: string
  help: string
  type: 'boolean' | 'value' | 'optional-value' | 'multi-value'
  metavar?: string
  choices?: string[]
  exclusiveGroup?: string
  category: string
}

export interface DetailField {
  id: string
  label: string
  value: string | boolean | number | string[] | Record<string, string> | VersionStatsValue | null
  editable?: boolean
  editType?:
    | 'select'
    | 'boolean'
    | 'text'
    | 'number'
    | 'path'
    | 'channel-cards'
    | 'version-stats'
    | 'args-builder'
    | 'env-vars'
    | 'model-dirs'
    | 'hidden'
  options?: DetailFieldOption[]
  groupLabels?: string[]
  refreshSection?: boolean
  onChangeAction?: string
  browseOnly?: boolean
  nested?: boolean
  rowGroup?: string
  tooltip?: string
  turnOnDisabled?: boolean
  turnOnDisabledTooltipKey?: string
  requiresRestart?: boolean
  description?: string
  placeholder?: string
  min?: number
  max?: number
}

export interface ActionDef {
  id: string
  label: string
  style?: 'primary' | 'accent' | 'danger'
  enabled?: boolean
  disabledMessage?: string
  tooltip?: string
  confirm?: ConfirmDef
  showProgress?: boolean
  progressTitle?: string
  cancellable?: boolean
  data?: Record<string, unknown>
  fieldSelects?: FieldSelectDef[]
  select?: SelectDef
  prompt?: PromptDef
}

export interface ConfirmDef {
  title?: string
  message?: string
  confirmLabel?: string
  options?: ConfirmOption[]
  messageDetails?: ModalDetailGroup[]
  restoreDiff?: SnapshotDiffResult | null
}

export interface ConfirmOption {
  id: string
  label: string
  checked?: boolean
}

export interface FieldSelectDef {
  sourceId: string
  fieldId: string
  field: string
  title?: string
  message?: string
  emptyMessage?: string
}

export interface SelectDef {
  source: string
  excludeSelf?: boolean
  filters?: Record<string, string>
  title?: string
  message?: string
  field: string
  emptyMessage?: string
}

export interface PromptDef {
  title?: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  field: string
  required?: boolean | string
  messageDetails?: ModalDetailGroup[]
  uniquifyDefault?: boolean
}

export interface ModalDetailGroup {
  label: string
  items: string[]
}

export interface ListAction {
  id: string
  label: string
  style?: 'primary' | 'danger'
  enabled?: boolean
  disabledMessage?: string
  confirm?: { title?: string; message?: string }
  showProgress?: boolean
  progressTitle?: string
  cancellable?: boolean
}

export interface ShowProgressOpts {
  installationId: string
  title: string
  apiCall: () => Promise<unknown>
  cancellable?: boolean
  returnTo?: string
  triggersInstanceStart?: boolean
  autoLaunchOnFinish?: boolean
  opKind?: 'launch' | 'install' | 'update' | 'destructive' | 'snapshot' | 'generic'
  chainSpan?: 'install' | 'launch'
  destroysInstance?: boolean
  actionId?: string
  actionData?: Record<string, unknown>
  successTerminal?: {
    title?: string
    actions: Array<{ id: string; label: string; variant: 'primary' | 'ghost' }>
  }
}

export interface ActionResult {
  ok?: boolean
  navigate?: 'list' | 'detail'
  message?: string
  mode?: 'console' | 'window'
  portConflict?: PortConflictInfo
  cancelled?: boolean
  running?: boolean
  newInstallationId?: string
}

export interface PortConflictInfo {
  port: number
  pids?: number[]
  nextPort?: number
  isComfy?: boolean
  priorBusy?: boolean
  priorUnknown?: boolean
  priorSurvivors?: boolean
}

export interface AddResult {
  ok: boolean
  message?: string
  entry?: Installation
}

export interface KillResult {
  ok: boolean
}

export interface QuitActiveItem {
  name: string
  type: 'session' | 'operation' | 'download'
}

export interface SettingsSection {
  title?: string
  fields: SettingsField[]
  actions?: SettingsAction[]
}

export interface SettingsAction {
  label: string
  url?: string
  action?: string
}

export interface SettingsField {
  id: string
  label: string
  type: 'text' | 'path' | 'select' | 'boolean' | 'pathList' | 'number'
  value: string | boolean | number | string[] | null
  readonly?: boolean
  options?: { value: string; label: string }[]
  openable?: boolean
  placeholder?: string
  min?: number
  max?: number
  tooltip?: string
  description?: string
}

export interface ModelsResult {
  systemDefault: string
  sections: ModelsSection[]
}

export interface ModelsSection {
  title?: string
  fields: ModelsField[]
}

export interface ModelsField {
  id: string
  label: string
  type: 'pathList'
  value: string[]
  tooltip?: string
}

export interface ProbeResult {
  sourceLabel: string
  version?: string
  repo?: string
  branch?: string
  installPath?: string
  [key: string]: unknown
}

export interface ProgressData {
  installationId: string
  phase: string
  status?: string
  percent?: number
  steps?: ProgressStep[]
  error?: boolean
  cancelRequested?: boolean
}

export interface ProgressStep {
  phase: string
  label: string
  weight?: number
}

export interface AdoptPromptRequest {
  promptId: string
  type: 'info' | 'warning' | 'error' | 'question'
  title: string
  message: string
  detail?: string
  detailLabel?: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

export interface AdoptPromptAck {
  promptId: string
}

export interface AdoptPromptResponse {
  promptId: string
  buttonIndex: number
}

export interface ComfyOutputData {
  installationId: string
  text: string
}

export interface TerminalRestore {
  buffer: string[]
  size: { cols: number; rows: number }
  exited: boolean
}

export type CrashKind =
  | 'access-violation'
  | 'illegal-instruction'
  | 'stack-buffer-overrun'
  | 'heap-corruption'
  | 'unknown'

export interface ComfyExitedData {
  installationId: string
  installationName: string
  crashed?: boolean
  exitCode?: number
  signal?: string
  lastStderr?: string
  exitCodeHex?: string
  crashKind?: CrashKind
  vcRuntimeMissing?: string[]
  crashedAtMs?: number
}

export interface ComfyBootLogData {
  installationId: string
  bootStderr: string
}

export interface GPUInfo {
  id?: string
  label: string
  model?: string | null
}

export interface HardwareValidation {
  supported: boolean
  error?: string
  warning?: string
}

export interface NvidiaDriverCheck {
  driverVersion: string
  minimumVersion: string
  supported: boolean
}

export type TemplateDownloadStatus = 'resolving' | 'downloading' | 'done' | 'error' | 'cancelled'

export interface ExampleWorkflowDownload {
  status: TemplateDownloadStatus
  percent: number
  message: string
  error?: string
}

export interface DiskSpaceInfo {
  free: number
  total: number
}

export type PathIssue = 'insideAppBundle' | 'oneDrive' | 'insideSharedDir' | 'insideExistingInstall'

export type ModelDownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface ModelDownloadProgress {
  id?: string
  url: string
  filename: string
  directory?: string
  savePath?: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  status: ModelDownloadStatus
  error?: string
  createdAt?: number
  isImage?: boolean
}

export interface TrackResult {
  ok: boolean
  message?: string
}

export interface SystemGpuInfo {
  vendor: string
  model: string
  vram_mb: number | null
  driver_version: string | null
}

export interface SystemInfo {
  gpu_vendor: string | null
  gpu_label: string | null
  gpu_model: string | null
  gpu_vram_mb: number | null
  gpu_vram_gb: number | null
  gpu_tier: GpuTier
  gpus: SystemGpuInfo[]
  nvidia_driver_version: string | null
  nvidia_driver_supported: boolean | null
  amd_driver_version: string | null
  intel_driver_version: string | null
  platform: string
  arch: string
  os_version: string
  os_distro: string | null
  os_release: string | null
  os_arch: string | null
  electron_version: string
  chrome_version: string
  total_memory_gb: number
  cpu_model: string
  cpu_cores: number
  cpu_physical_cores: number | null
  cpu_speed_ghz: number | null
  cpu_manufacturer: string | null
  app_version: string
  auto_update: boolean
  locale: string
  installation_count: number
  installations: Array<{
    source_id: string
    variant: string
    update_channel: string
    status: string
  }>
}

export interface PerformanceTestResultsSummary {
  createdAt: string
  instance: {
    id: string
    name: string
  }
  workspace: {
    id: string | null
    name: string | null
  }
  workflowName: string
  fastestJobDurationSeconds: number | null
  slowestJobDurationSeconds: number | null
  averageJobDurationSeconds: number | null
  medianJobDurationSeconds: number | null
  measuredJobCount: number
  failedRunCount: number
  hardware: {
    deviceType: string
    deviceIndex: number | null
    deviceName: string | null
    backend: string | null
    devices: Array<{
      deviceType: string
      deviceIndex: number | null
      deviceName: string | null
      backend: string | null
    }>
    vramMb: number | null
    ramMb: number | null
    pytorchVersion: string | null
    xformersVersion: string | null
    cudaDeviceSet: number | null
  } | null
  systemInfo: SystemInfo
}

export interface AcceleratorInfo {
  deviceType: string
  deviceIndex: number | null
  deviceName: string | null
  backend: string | null
}

export interface AcceleratorSnapshot extends AcceleratorInfo {
  devices: AcceleratorInfo[]
  vramMb: number | null
  ramMb: number | null
  pytorchVersion: string | null
  xformersVersion: string | null
  cudaDeviceSet: number | null
}

export interface PerformanceTestDurationResult {
  jobId: string
  durationSeconds: number
}

export interface PerformanceTestStatistics {
  fastest: PerformanceTestDurationResult
  slowest: PerformanceTestDurationResult
  averageDurationSeconds: number
  medianDurationSeconds: number
  measuredJobCount: number
}

export interface RunPerformanceTestWorkflowResult {
  ok: boolean
  submitted: number
  preparationRuns: number
  totalSubmitted: number
  promptIds?: string[]
  resultPath?: string
  resultsSummaryPath?: string
  failedRuns?: number
  statistics?: PerformanceTestStatistics | null
  hardware?: AcceleratorSnapshot | null
  systemInfo?: SystemInfo
  resultsSummary?: PerformanceTestResultsSummary
  cancelled?: boolean
  message?: string
}

export type PerformanceTestResultValue =
  | string
  | number
  | boolean
  | null
  | PerformanceTestResultValue[]
  | { [key: string]: PerformanceTestResultValue }

export interface PerformanceTestBenchmark {
  id: string
  createdAt: string | null
  instance: {
    id: string
    name: string
  }
  workspace: {
    id: string | null
    name: string | null
  }
  workflowName: string
  fastestJobDurationSeconds: number | null
  slowestJobDurationSeconds: number | null
  averageJobDurationSeconds: number | null
  medianJobDurationSeconds: number | null
  measuredJobCount: number
  hardwareName: string | null
  result: Record<string, PerformanceTestResultValue>
}

export interface SnapshotDiffEntry {
  createdAt: string
  trigger: string
  label: string | null
  nodesAdded: Array<{
    id: string
    type: string
    dirName: string
    enabled: boolean
    version?: string
    commit?: string
  }>
  nodesRemoved: Array<{
    id: string
    type: string
    dirName: string
    enabled: boolean
    version?: string
    commit?: string
  }>
  nodesChanged: Array<{
    id: string
    from: { version?: string; commit?: string; enabled: boolean }
    to: { version?: string; commit?: string; enabled: boolean }
  }>
  pipsAdded: Array<{ name: string; version: string }>
  pipsRemoved: Array<{ name: string; version: string }>
  pipsChanged: Array<{ name: string; from: string; to: string }>
  comfyuiChanged: boolean
  comfyui?: {
    from: { ref: string; commit: string | null }
    to: { ref: string; commit: string | null }
  }
  updateChannelChanged: boolean
  updateChannel?: { from: string; to: string }
}

export interface InstallationDdContext {
  installation_id: string
  variant: string
  source_id: string
  update_channel: string
  comfyui_version: string
  copied_from?: string
  copy_reason?: string
  snapshot_count: number
  disk_free_gb: number | null
  disk_total_gb: number | null
  latest_snapshot: {
    createdAt: string
    trigger: string
    label: string | null
    comfyui: {
      ref: string
      commit: string | null
      releaseTag: string
      variant: string
    }
    customNodes: Array<{
      id: string
      type: string
      dirName: string
      enabled: boolean
      version?: string
      commit?: string
    }>
    pipPackages: Record<string, string>
    pythonVersion?: string
    updateChannel?: string
  } | null
  snapshot_diffs: SnapshotDiffEntry[]
}

export interface InstallInventoryEntry {
  installation_id: string
  source_id: string
  variant: string
  update_channel: string
  comfyui_version: string
  snapshot_count: number
  last_launched_at: number | null
  latest_snapshot: {
    createdAt: string
    trigger: string
    has_label: boolean
    comfyui: { ref: string; commit: string | null; releaseTag: string }
    custom_nodes_count: number
    pip_packages_count: number
  } | null
  snapshot_diffs: Array<{
    createdAt: string
    trigger: string
    has_label: boolean
    nodesAdded: number
    nodesRemoved: number
    nodesChanged: number
    pipsAdded: number
    pipsRemoved: number
    pipsChanged: number
    comfyuiChanged: boolean
    updateChannelChanged: boolean
  }>
}

export interface InstallsInventory {
  total_install_count: number
  included_install_count: number
  truncated: boolean
  installs: InstallInventoryEntry[]
}

export interface DatadogForwardedError {
  source: string
  message: string
  stack?: string
  level?: 'debug' | 'info' | 'warn' | 'error' | 'critical'
  context?: Record<string, unknown>
  skipPostHog?: boolean
}

export interface CopyEvent {
  installationId: string
  installationName: string
  copiedAt: string
  copyReason: 'copy' | 'copy-update' | 'copy-pytorch' | 'release-update'
  exists: boolean
  direction: 'in' | 'out'
}

export interface SnapshotDiffSummary {
  nodesAdded: number
  nodesRemoved: number
  nodesChanged: number
  pipsAdded: number
  pipsRemoved: number
  pipsChanged: number
  comfyuiChanged: boolean
  updateChannelChanged: boolean
}

export interface SnapshotSummary {
  filename: string
  createdAt: string
  trigger: 'boot' | 'restart' | 'manual' | 'pre-update' | 'post-update' | 'post-restore'
  label: string | null
  comfyuiVersion: string
  nodeCount: number
  pipPackageCount: number
  diffVsPrevious?: SnapshotDiffSummary
}

export interface SnapshotListData {
  snapshots: SnapshotSummary[]
  copyEvents: CopyEvent[]
  totalCount: number
  context: {
    updateChannel: string
    pythonVersion: string
    variant: string
    variantLabel: string
  }
}

export interface SnapshotNodeInfo {
  id: string
  type: 'cnr' | 'git' | 'file'
  dirName: string
  enabled: boolean
  version?: string
  commit?: string
  url?: string
}

export interface SnapshotDetailData {
  filename: string
  createdAt: string
  trigger: string
  label: string | null
  comfyuiVersion: string
  comfyui: {
    ref: string
    commit: string | null
    releaseTag: string
    variant: string
  }
  pythonVersion?: string
  updateChannel?: string
  customNodes: SnapshotNodeInfo[]
  pipPackageCount: number
  pipPackages: Record<string, string>
}

export interface SnapshotDiffNodeChange {
  id: string
  type: string
  from: { version?: string; commit?: string; enabled: boolean }
  to: { version?: string; commit?: string; enabled: boolean }
}

export interface SnapshotDiffResult {
  comfyuiChanged: boolean
  comfyui?: {
    from: { ref: string; commit: string | null; formattedVersion: string }
    to: { ref: string; commit: string | null; formattedVersion: string }
  }
  updateChannelChanged: boolean
  updateChannel?: { from: string; to: string }
  nodesAdded: SnapshotNodeInfo[]
  nodesRemoved: SnapshotNodeInfo[]
  nodesChanged: SnapshotDiffNodeChange[]
  pipsAdded: Array<{ name: string; version: string }>
  pipsRemoved: Array<{ name: string; version: string }>
  pipsChanged: Array<{ name: string; from: string; to: string }>
}

export interface SnapshotDiffData {
  mode: 'previous' | 'current'
  baseLabel: string
  diff: SnapshotDiffResult
  empty: boolean
}

export interface SnapshotFilePreview {
  filePath: string
  installationName: string
  snapshotCount: number
  snapshots: SnapshotSummary[]
  newestSnapshot: SnapshotDetailData
}

export interface ErrorDetailData {
  installationId: string
  message: string
}

export interface AppUpdateState {
  kind: 'available' | 'downloading' | 'ready' | null
  version: string | null
  autoUpdate: boolean
}

export interface AppUpdateDownloadProgress {
  percent: number | null
  transferred: number | null
  total: number | null
  bytesPerSecond: number | null
}

export interface ElectronApi {
  platform: NodeJS.Platform

  getSources(): Promise<Source[]>
  getFieldOptions(
    sourceId: string,
    fieldId: string,
    selections: Record<string, FieldOption>,
    context?: Record<string, unknown>
  ): Promise<FieldOption[]>
  buildInstallation(
    sourceId: string,
    selections: Record<string, FieldOption>
  ): Promise<Record<string, unknown>>
  getDefaultInstallDir(): Promise<string>
  detectGPU(): Promise<GPUInfo | null>
  validateHardware(): Promise<HardwareValidation>
  checkNvidiaDriver(): Promise<NvidiaDriverCheck | null>

  browseFolder(defaultPath?: string): Promise<string | null>
  importPerformanceTestWorkflow(filePath?: string): Promise<{
    ok: boolean
    filePath?: string
    message?: string
    canceled?: boolean
  }>
  getPerformanceTestExampleWorkflows(
    installationId: string
  ): Promise<{ options: FieldOption[]; diskSpace: DiskSpaceInfo | null }>
  preparePerformanceTestExampleWorkflow(
    installationId: string,
    templateId: string
  ): Promise<{
    ok: boolean
    filePath?: string
    download?: ExampleWorkflowDownload
    reason?: 'offline' | 'unavailable'
    message?: string
  }>
  deletePerformanceTestWorkflow(
    filePath: string
  ): Promise<{ ok: boolean; status?: 'deleted' | 'preserved'; message?: string }>
  savePerformanceTestLogs(
    filePath: string,
    logs: string
  ): Promise<{ ok: boolean; logsPath?: string; message?: string }>
  listPerformanceTestBenchmarks(folderPath?: string): Promise<{
    folderPath: string
    benchmarks: PerformanceTestBenchmark[]
  }>
  deletePerformanceTestBenchmark(
    folderPath: string,
    sessionId: string
  ): Promise<{ ok: boolean; message?: string }>
  renamePerformanceTestBenchmark(
    folderPath: string,
    sessionId: string,
    newSessionId: string
  ): Promise<{ ok: boolean; sessionId?: string; message?: string }>
  runPerformanceTestWorkflow(
    sessionId: string,
    filePath: string,
    measuredRuns: number,
    warmupRuns: number
  ): Promise<RunPerformanceTestWorkflowResult>
  readPerformanceTestResultsSummary(filePath: string): Promise<PerformanceTestResultsSummary>
  exportResultsImage(
    png: ArrayBuffer,
    imageType: 'performance-test' | 'benchmark-comparison',
    defaultPath?: string
  ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; message?: string }>
  openPath(targetPath: string): Promise<void>
  revealPath(targetPath: string): void
  openExternal(url: string): Promise<void>
  getDiskSpace(targetPath: string): Promise<DiskSpaceInfo>
  logsSnapshot(installationId: string): Promise<string>
  validateInstallPath(targetPath: string): Promise<PathIssue[]>
  getInstallationSize(installationId: string): Promise<{ sizeBytes: number }>
  cancelInstallationSize(): Promise<void>

  getLocaleMessages(): Promise<Record<string, unknown>>
  getAvailableLocales(): Promise<{ value: string; label: string }[]>
  getLocale(): Promise<string>

  getFirstUseState(): Promise<{ skipPick: boolean; hasLegacyDesktop: boolean }>

  getInstallations(): Promise<Installation[]>
  getInstallationsSummary(): Promise<{
    localCount: number
    hasLaunchedCloud: boolean
    hasLegacyDesktop: boolean
  }>
  addInstallation(data: Record<string, unknown>): Promise<AddResult>
  reorderInstallations(orderedIds: string[]): Promise<void>
  probeInstallation(dirPath: string): Promise<ProbeResult[]>
  trackInstallation(data: Record<string, unknown>): Promise<TrackResult>
  installInstance(installationId: string, express?: boolean): Promise<void>
  skipTemplateDownload(installationId: string): Promise<void>
  updateInstallation(
    installationId: string,
    data: Record<string, unknown>
  ): Promise<ActionResult | void>

  stopComfyUI(installationId: string): Promise<void>
  focusComfyWindow(installationId: string): Promise<boolean>

  terminalSubscribe(installationId: string): Promise<TerminalRestore>
  terminalUnsubscribe(installationId: string): Promise<void>
  terminalWrite(installationId: string, data: string): Promise<void>
  terminalResize(installationId: string, cols: number, rows: number): Promise<void>
  terminalRestart(installationId: string): Promise<TerminalRestore>
  openInstallWindow(installationId: string): Promise<boolean>
  openInstallInNewWindow(installationId: string): void
  closeComfyWindow(installationId: string, opts?: { skipConfirm?: boolean }): Promise<boolean>
  closeHostWindow(): Promise<boolean>
  returnToDashboard(): Promise<boolean>
  closeCurrentPanel(): void
  closeAnnouncement(): void
  signalOverlayReady(): void
  navigatePanel(page: DashboardPage): void
  listAssets(installationId: string): Promise<AssetSummary[]>
  listHomeWorkflows(): Promise<CatalogWorkflow[]>
  openCatalogWorkflow(id: string): Promise<boolean>
  openCatalogWorkflowHub(): Promise<boolean>
  getBuildStorageSnapshot(): Promise<BuildStorageSnapshot>
  resolveStartupRestoreReveal(result: 'takeover-ready' | 'dashboard-fallback'): void
  openGlobalSettings(
    tab?: 'general' | 'updates' | 'storage' | 'advanced' | 'logs',
    opts?: {
      highlightField?: string
    }
  ): void
  openInstancePicker(opts?: {
    installationId?: string | null
    initialTab?: 'config' | 'status' | 'update' | 'snapshots' | 'storage' | 'console'
    autoAction?: string | null
  }): void
  setFirstUseMode(mode: FirstUseMode): void
  onFirstUseSkip(callback: () => void): Unsubscribe
  onOpenFeedback(callback: (data: { source: 'titlebar' | 'menu' }) => void): Unsubscribe
  onOpenAnnouncement(callback: () => void): Unsubscribe
  onCloseRequest(callback: (data: { requestId: string }) => void): Unsubscribe
  respondCloseRequest(payload: { requestId: string; cleared?: boolean; defer?: boolean }): void
  ackCloseRequest(payload: { requestId: string }): void
  onReturnToDashboardRequest(callback: (data: { requestId: string }) => void): Unsubscribe
  respondReturnToDashboardRequest(payload: { requestId: string; cleared: boolean }): void
  ackReturnToDashboardRequest(payload: { requestId: string }): void
  transferHostBoundsToInstall(installationId: string): Promise<boolean>
  claimAttachHost(installationId: string): Promise<boolean>
  releaseAttachHostPreview(): Promise<boolean>
  getRunningInstances(): Promise<RunningInstance[]>
  getLaunchingInstances(): Promise<{ installationId: string; installationName: string }[]>
  getStoppingInstances(): Promise<string[]>
  getActiveOperations(): Promise<{ installationId: string; actionId: string }[]>
  getLastCrashError(installationId: string): Promise<ComfyExitedData | null>
  getCrashInstances(): Promise<ComfyExitedData[]>
  cancelLaunch(): Promise<void>
  cancelOperation(installationId: string): Promise<void>
  killPortProcess(port: number): Promise<KillResult>

  getListActions(installationId: string): Promise<ListAction[]>
  getDetailSections(installationId: string): Promise<DetailSection[]>
  getComfyArgs(installationId: string): Promise<{ args: ComfyArgDef[]; error?: string } | null>
  getCoreBetaArgs(installationId: string, launchArgs?: string): Promise<CoreBetaArgs>
  runAction(
    installationId: string,
    actionId: string,
    actionData?: Record<string, unknown>
  ): Promise<ActionResult>

  getSnapshots(installationId: string): Promise<SnapshotListData>
  getSnapshotDetail(installationId: string, filename: string): Promise<SnapshotDetailData>
  getSnapshotDiff(
    installationId: string,
    filename: string,
    mode: 'previous' | 'current'
  ): Promise<SnapshotDiffData>
  exportSnapshot(
    installationId: string,
    filename: string
  ): Promise<{ ok: boolean; message?: string }>
  exportAllSnapshots(installationId: string): Promise<{ ok: boolean; message?: string }>
  importSnapshotsPreview(): Promise<{
    ok: boolean
    preview?: SnapshotFilePreview
    message?: string
  }>
  importSnapshotsDiff(
    installationId: string
  ): Promise<{ ok: boolean; diff?: SnapshotDiffData; message?: string }>
  importSnapshotsConfirm(installationId: string): Promise<{
    ok: boolean
    imported?: number
    restoreToken?: string
    torchStackNotice?: string | null
    message?: string
  }>
  previewSnapshotFile(): Promise<{ ok: boolean; preview?: SnapshotFilePreview; message?: string }>
  previewLocalMigration(installationId: string): Promise<{
    ok: boolean
    message?: string
    preview?: SnapshotFilePreview
    snapshotPath?: string
  }>
  previewSnapshotPath(
    filePath: string
  ): Promise<{ ok: boolean; preview?: SnapshotFilePreview; message?: string }>
  createFromSnapshot(
    filePath: string,
    name?: string,
    releaseTag?: string,
    variantId?: string
  ): Promise<{ ok: boolean; entry?: { id: string; name: string }; message?: string }>
  getPathForFile(file: File): string

  getSettingsSections(): Promise<SettingsSection[]>
  getModelsSections(): Promise<ModelsResult>
  getMediaSections(): Promise<SettingsSection[]>
  getUniqueName(baseName: string): Promise<string>
  setSetting(key: string, value: unknown): Promise<void>
  getSetting(key: string): Promise<unknown>

  getPendingBetaNotice(installationId: string): Promise<BetaActivationNotice | null>
  acknowledgeBetaNotice(installationId: string, shownArgs?: string[]): Promise<void>

  getResolvedTheme(): Promise<ResolvedTheme>

  getAppVersion(): Promise<string>
  getStableTags(): Promise<string[]>
  getCloudUserTier(): Promise<CloudUserTier>
  getCloudFreeRunsEnabled(): Promise<boolean>
  quitApp(): Promise<void>
  relaunchApp(): Promise<void>
  resetZoom(): Promise<void>
  getSystemInfo(): Promise<SystemInfo>
  getInstallationDdContext(installationId: string): Promise<InstallationDdContext | null>
  getInstallsInventory(): Promise<InstallsInventory>
  getDeviceId(): Promise<string>

  comfybuilder: {
    signIn(): Promise<AuthStatus>
    signOut(): Promise<AuthStatus>
    getAuthStatus(): Promise<AuthStatus>
    onAuthChanged(callback: (status: AuthStatus) => void): Unsubscribe
    listWorkspaces(): Promise<Workspace[]>
    switchWorkspace(workspaceId: string): Promise<AuthStatus>
    listBuilds(): Promise<DevPlatformBuild[]>
    openBuildsPage(workspaceId: string): Promise<void>
    installBuild(request: InstallBuildRequest): Promise<InstallBuildResult>
    promoteLocalInstance(installationId: string): Promise<PromoteLocalInstanceResult>
  }

  checkForUpdate(): Promise<{ available: boolean; version?: string; error?: string }>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  getUpdateCapabilities(): Promise<{ canAutoUpdate: boolean; systemManaged: boolean }>
  getAppUpdateState(): Promise<AppUpdateState>

  listModelDownloads(): Promise<ModelDownloadProgress[]>
  pauseModelDownload(ref: string): Promise<boolean>
  resumeModelDownload(ref: string): Promise<boolean>
  cancelModelDownload(ref: string): Promise<boolean>
  dismissModelDownload(ref: string): Promise<boolean>
  clearFinishedModelDownloads(): Promise<number>
  retryModelDownload(ref: string): Promise<boolean>
  showDownloadInFolder(savePath: string): Promise<void>
  getDownloadThumbnail(savePath: string): Promise<string | null>

  onAdoptPrompt(callback: (request: AdoptPromptRequest) => void): Unsubscribe
  ackAdoptPrompt(payload: AdoptPromptAck): void
  respondAdoptPrompt(payload: AdoptPromptResponse): void

  onInstallProgress(callback: (data: ProgressData) => void): Unsubscribe
  onComfyOutput(callback: (data: ComfyOutputData) => void): Unsubscribe
  onPerformanceTestProgress(
    callback: (data: { sessionId: string; completedRuns: number; totalRuns: number }) => void
  ): Unsubscribe
  onPerformanceTestExampleDownload(
    callback: (data: { filePath: string; download: ExampleWorkflowDownload }) => void
  ): Unsubscribe
  onComfyExited(callback: (data: ComfyExitedData) => void): Unsubscribe
  onInstanceCrashed(callback: (data: ComfyExitedData) => void): Unsubscribe
  onTerminalOutput(callback: (data: { installationId: string; data: string }) => void): Unsubscribe
  onTerminalExited(callback: (data: { installationId: string }) => void): Unsubscribe
  onComfyBootLog(callback: (data: ComfyBootLogData) => void): Unsubscribe
  onInstanceLaunching(
    callback: (data: { installationId: string; installationName: string }) => void
  ): Unsubscribe
  onInstanceLaunchFailed(callback: (data: { installationId: string }) => void): Unsubscribe
  onInstanceStarted(callback: (data: RunningInstance) => void): Unsubscribe
  onInstanceStopping(callback: (data: { installationId: string }) => void): Unsubscribe
  onInstanceStopped(callback: (data: { installationId: string }) => void): Unsubscribe
  onOperationChanged(
    callback: (data: { installationId: string; actionId: string; active: boolean }) => void
  ): Unsubscribe
  onThemeChanged(callback: (theme: ResolvedTheme) => void): Unsubscribe
  onLocaleChanged(
    callback: (payload: { locale: string; messages: Record<string, unknown> }) => void
  ): Unsubscribe
  onConfirmQuit(callback: (details: QuitActiveItem[]) => void): Unsubscribe
  onInstallationsChanged(callback: () => void): Unsubscribe
  onInstallationsVersionsUpdated(
    callback: (updates: { id: string; version: string }[]) => void
  ): Unsubscribe
  onReleaseCacheEnriched(callback: (data: { repo: string }) => void): Unsubscribe
  onAppUpdatePromptRestart(callback: (data: { version: string }) => void): Unsubscribe
  onAppUpdateStateChanged(callback: (state: AppUpdateState) => void): Unsubscribe
  onAppUpdateDownloadProgress(callback: (progress: AppUpdateDownloadProgress) => void): Unsubscribe
  onAppUpdateUserActionFailed(callback: (err: { message: string }) => void): Unsubscribe
  onZoomChanged(callback: (level: number) => void): Unsubscribe
  onModelDownloadProgress(callback: (progress: ModelDownloadProgress) => void): Unsubscribe
  onModelDownloadRemoved(callback: (data: { url: string; id?: string }) => void): Unsubscribe
  onModelDownloadsClearedFinished(
    callback: (data: { urls: string[]; refs?: string[] }) => void
  ): Unsubscribe
  captureTelemetry(event: string, properties: Record<string, unknown>): void
  captureExceptionTelemetry(payload: {
    message: string
    stack?: string
    properties?: Record<string, unknown>
  }): void
  registerTelemetryProperties(properties: Record<string, unknown>): void
  telemetryGetExperimentFlag(key: string): Promise<string | boolean | null>
  telemetryRecordExposure(payload: {
    experimentKey: string
    variant: string
    source?: 'cache' | 'remote' | 'fallback'
  }): void
  onTelemetrySettingChanged(callback: (enabled: boolean | undefined) => void): Unsubscribe
  onDatadogError(callback: (payload: DatadogForwardedError) => void): Unsubscribe
  onTelemetryActionFromMain(
    callback: (data: {
      event: string
      context: Record<string, unknown>
      mainAlreadyCaptured?: boolean
    }) => void
  ): Unsubscribe
  onErrorDetail(callback: (data: ErrorDetailData) => void): Unsubscribe
  onSuggestChineseMirrors(callback: () => void): Unsubscribe
  onSettingsChanged(callback: (data: { key: string }) => void): Unsubscribe
  onPanelSwitch(callback: (data: { panel: string; installationId?: string }) => void): Unsubscribe
  onPanelTriggerOverlay(
    callback: (data: {
      kind:
        | 'install-update'
        | 'app-update-restart-prompt'
        | 'app-update-download-prompt'
        | 'open-settings'
        | 'picker-pick-install'
        | 'picker-install-action'
        | 'picker-show-progress'
      installationId?: string
      actionId?: string
      actionData?: Record<string, unknown>
      version?: string | null
      settingsTab?: 'comfy' | 'directories' | 'downloads' | 'global' | 'global-storage'
      title?: string
      cancellable?: boolean
      startupRestore?: boolean
      triggersInstanceStart?: boolean
      opKind?: 'launch' | 'install' | 'update' | 'destructive' | 'snapshot' | 'generic'
      isRestart?: boolean
      successChoice?: boolean
    }) => void
  ): Unsubscribe
}

export const IN_PLACE_RELAUNCH = new Set(['update-comfyui', 'snapshot-restore', 'change-pytorch'])

export const REQUIRES_STOPPED = new Set([
  'delete',
  'copy',
  'copy-update',
  'copy-pytorch',
  'release-update',
  'migrate-to-standalone',
  'snapshot-restore',
  'update-comfyui',
  'migrate-from',
  'change-pytorch'
])

export const POPUP_KIND = {
  menu: 'menu',
  downloads: 'downloads',
  downloadsFull: 'downloads-full',
  instancePicker: 'instance-picker',
  globalSettings: 'global-settings'
} as const

export type TitlePopupKind = (typeof POPUP_KIND)[keyof typeof POPUP_KIND]

export interface PopupTheme {
  bg: string
  text: string
}

export const PICKER_SETTINGS_CHANNELS = {
  getDetailSections: 'comfy-titlepopup:picker-settings-get-detail-sections',
  getDiskSpace: 'comfy-titlepopup:picker-settings-get-disk-space',
  getInstallationSize: 'comfy-titlepopup:picker-settings-get-installation-size',
  updateInstallation: 'comfy-titlepopup:picker-settings-update-installation',
  runAction: 'comfy-titlepopup:picker-settings-run-action',
  getFieldOptions: 'comfy-titlepopup:picker-settings-get-field-options',
  getInstallations: 'comfy-titlepopup:picker-settings-get-installations',
  stopComfyUI: 'comfy-titlepopup:picker-settings-stop-comfyui',
  cancelOperation: 'comfy-titlepopup:picker-settings-cancel-operation',
  getSnapshots: 'comfy-titlepopup:picker-settings-get-snapshots',
  getSnapshotDetail: 'comfy-titlepopup:picker-settings-get-snapshot-detail',
  getSnapshotDiff: 'comfy-titlepopup:picker-settings-get-snapshot-diff',
  exportSnapshot: 'comfy-titlepopup:picker-settings-export-snapshot',
  exportAllSnapshots: 'comfy-titlepopup:picker-settings-export-all-snapshots',
  importSnapshotsPreview: 'comfy-titlepopup:picker-settings-import-snapshots-preview',
  importSnapshotsDiff: 'comfy-titlepopup:picker-settings-import-snapshots-diff',
  importSnapshotsConfirm: 'comfy-titlepopup:picker-settings-import-snapshots-confirm',
  previewSnapshotFile: 'comfy-titlepopup:picker-settings-preview-snapshot-file',
  getComfyArgs: 'comfy-titlepopup:picker-settings-get-comfy-args',
  getCoreBetaArgs: 'comfy-titlepopup:picker-settings-get-core-beta-args',
  browseFolder: 'comfy-titlepopup:picker-settings-browse-folder',
  previewLocalMigration: 'comfy-titlepopup:picker-settings-preview-local-migration',
  relaunchApp: 'comfy-titlepopup:picker-settings-relaunch-app',
  getLocaleMessages: 'comfy-titlepopup:picker-settings-get-locale-messages',
  getLocale: 'comfy-titlepopup:picker-settings-get-locale',
  getStableTags: 'comfy-titlepopup:picker-settings-get-stable-tags',
  getUniqueName: 'comfy-titlepopup:picker-settings-get-unique-name',
  openGlobalSettings: 'comfy-titlepopup:picker-settings-open-global-settings'
} as const
