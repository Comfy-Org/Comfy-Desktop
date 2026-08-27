<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, HardDrive, CircleAlert, RefreshCw } from 'lucide-vue-next'
import { useModal } from '../composables/useModal'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'

import type {
  InstallBuildResult,
  Source,
  SourceField,
  FieldOption,
  HardwareValidation,
  ShowProgressOpts
} from '../types/ipc'
import { stripVariantPrefix, sortedCardOptions } from '../lib/variants'
import { formatBytes } from '../lib/formatting'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { emitTelemetryAction, toSizeBucket, toVariantBucket, toErrorBucket } from '../lib/telemetry'
import {
  trackGuardrailBlocked,
  createDiskSpaceChecker,
  showPathIssueAlerts,
  checkNvidiaDriverOrWarn,
  checkDiskSpaceOrWarn,
  checkTemplateDiskOrBlock,
  isTemplateDiskBlocked,
  minTemplateModelBytes,
  isApiNodeTemplate,
  templateSizeBytes
} from '../lib/installHelpers'
import TakeoverBack from '../components/TakeoverBack.vue'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import BrandVariantList from '../components/BrandVariantList.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'
import TooltipWrap from '../components/TooltipWrap.vue'
import { BaseSelect, type BaseSelectOption } from '../components/ui'
import type { Build, BuildTarget } from '../devplatform/types'

const emit = defineEmits<{
  close: []
  'show-progress': [opts: ShowProgressOpts]
  'navigate-list': []
  /** Configure footer's Back link when opened by the first-use chain; host returns to the FirstUseTakeover localBranch step. */
  'back-to-local-branch': []
}>()

const props = withDefaults(
  defineProps<{
    /** Hide the "Back to Dashboard" chevron when chained from the first-use takeover. */
    hideBackToDashboard?: boolean
  }>(),
  { hideBackToDashboard: false }
)

const { t } = useI18n()
const modal = useModal()
const authStore = useAuthStore()
const installationStore = useInstallationStore()

const sources = ref<Source[]>([])
const currentSource = ref<Source | null>(null)
const selections = ref<Record<string, FieldOption>>({})
const instName = ref('')
/** Placeholder's suggested default (`ComfyUI` -> `ComfyUI (2)` if taken). `handleSave`'s blank-field fallback produces the same value, so it's truthful. */
const suggestedName = ref('')
const instPath = ref('')
const defaultInstPath = ref('')
const detectedGpu = ref('')
/** Non-blocking hardware warning from `validateHardware()` (e.g. Linux AMD
 *  /dev/kfd inaccessible): install may proceed, but the user should know GPU
 *  acceleration will not work until they act. Plain-English text from main. */
const hardwareWarning = ref('')
const saveDisabled = ref(true)
const sourcesLoading = ref(false)
const initializing = ref(false)
const authorizingWorkspace = ref(false)
const sourceError = ref('')
const workspaceId = ref<string | null>(null)
const selectedBuildId = ref('')
const selectedBuildTargetId = ref('')
const workspaceMode = computed(() => workspaceId.value !== null)
const workspaceInstallMode = ref<'managed' | 'public'>('managed')
const managedBuildMode = computed(
  () => workspaceMode.value && workspaceInstallMode.value === 'managed'
)
const localInstallMode = computed(
  () => !workspaceMode.value || workspaceInstallMode.value === 'public'
)

function installationBacksBuild(build: Build): boolean {
  return installationStore.installations.some((installation) => {
    if (
      installation.status === 'failed' ||
      installation.sourceId !== 'comfybuilder' ||
      installation.workspaceId !== workspaceId.value
    ) {
      return false
    }
    if (installation.distributionId) return installation.distributionId === build.id
    return installation.name.trim().toLowerCase() === build.name.trim().toLowerCase()
  })
}

const workspaceBuilds = computed(() => {
  if (!workspaceId.value || authStore.status.workspaceId !== workspaceId.value) return []
  return authStore.builds.filter(
    (build) =>
      build.state === 'installable' &&
      build.installedVersion === undefined &&
      !installationBacksBuild(build)
  )
})
const workspaceBuildOptions = computed<BaseSelectOption[]>(() =>
  workspaceBuilds.value.map((build) => ({
    value: build.id,
    label: build.name,
    description: buildOptionDescription(build)
  }))
)
const selectedBuild = computed(
  () => workspaceBuilds.value.find((build) => build.id === selectedBuildId.value) ?? null
)
const selectedBuildTarget = computed(
  () =>
    selectedBuild.value?.releaseTargets?.find(
      (target) => target.artifactId === selectedBuildTargetId.value
    ) ?? null
)

function platformName(os: string): string {
  if (os === 'windows') return 'Windows'
  if (os === 'mac') return 'macOS'
  if (os === 'linux') return 'Linux'
  return os
}

function targetAccelerationName(target: BuildTarget): string {
  if (target.gpu === 'cpu') return 'CPU'
  if (target.gpu === 'mps') return 'Apple Silicon'
  if (target.gpu === 'nvidia') {
    const digits = /^cu(\d+)$/.exec(target.accelVariant)?.[1]
    if (!digits) return 'NVIDIA'
    const cudaVersion = digits.length > 1 ? `${digits.slice(0, -1)}.${digits.slice(-1)}` : digits
    return `NVIDIA (CUDA ${cudaVersion})`
  }
  if (target.gpu === 'amd') {
    return target.accelVariant && target.accelVariant !== 'amd'
      ? `AMD (${target.accelVariant.toUpperCase()})`
      : 'AMD'
  }
  return target.gpu
}

function targetVariantId(target: BuildTarget): string {
  const os = target.os === 'windows' ? 'win' : target.os
  return `${os}-${target.gpu}-${target.accelVariant}`
}

const selectedBuildTargetOptions = computed<FieldOption[]>(() =>
  (selectedBuild.value?.releaseTargets ?? []).map((target) => ({
    value: target.artifactId,
    label: `${platformName(target.os)} - ${targetAccelerationName(target)}`,
    description: t('newInstall.buildReleaseValue', { version: target.releaseVersion }),
    recommended: target.recommended,
    data: { variantId: targetVariantId(target) }
  }))
)

function buildOptionDescription(build: Build): string | undefined {
  const details = [
    build.description?.trim(),
    build.version ? t('newInstall.buildReleaseValue', { version: build.version }) : undefined,
    build.creatorName
      ? t('newInstall.buildCreatorValue', { creator: build.creatorName })
      : undefined
  ].filter((detail): detail is string => Boolean(detail))
  return details.length ? details.join(' | ') : undefined
}

const selectedBuildMetadata = computed(() => {
  const build = selectedBuild.value
  if (!build) return []
  const metadata: Array<{ label: string; value: string }> = []
  if (build.version) {
    metadata.push({ label: t('newInstall.buildRelease'), value: `v${build.version}` })
  }
  if (build.targetOs?.length) {
    metadata.push({
      label: t('newInstall.buildPlatforms'),
      value: build.targetOs.map(platformName).join(', ')
    })
  }
  if (build.creatorName) {
    metadata.push({ label: t('newInstall.buildCreator'), value: build.creatorName })
  }
  const modelCount = build.numModels ?? build.numAllowedModels
  if (typeof modelCount === 'number') {
    metadata.push({ label: t('newInstall.buildModels'), value: String(modelCount) })
  }
  if (typeof build.numCustomNodes === 'number') {
    metadata.push({ label: t('newInstall.buildCustomNodes'), value: String(build.numCustomNodes) })
  }
  const size = typeof build.sizeBytes === 'number' ? formatBytes(build.sizeBytes) : ''
  if (size) metadata.push({ label: t('newInstall.buildSize'), value: size })
  return metadata
})

watch(workspaceBuilds, (builds) => {
  if (!managedBuildMode.value) return
  if (!builds.some((build) => build.id === selectedBuildId.value)) {
    selectedBuildId.value = builds[0]?.id ?? ''
  }
})

function suggestManagedBuildName(build: Build | null): void {
  if (!managedBuildMode.value || !build || instName.value.trim()) return
  const buildId = build.id
  void window.api
    .getUniqueName(build.name)
    .then((name) => {
      if (managedBuildMode.value && selectedBuild.value?.id === buildId && !instName.value.trim()) {
        suggestedName.value = name
      }
    })
    .catch(() => {})
}

watch(selectedBuild, (build) => {
  const targets = build?.releaseTargets ?? []
  selectedBuildTargetId.value =
    targets.find((target) => target.recommended)?.artifactId ?? targets[0]?.artifactId ?? ''
  suggestManagedBuildName(build)
})

// Per-field state
const fieldOptions = ref(new Map<string, FieldOption[]>())
const fieldLoading = ref(new Map<string, boolean>())
const fieldErrors = ref(new Map<string, string>())
const textFieldValues = ref(new Map<string, string>())

// Disk space and path validation
const {
  diskSpace,
  diskSpaceLoading,
  pathIssues,
  fetchDiskSpace,
  reset: resetDiskSpace
} = createDiskSpaceChecker()
let hardwareValidation: HardwareValidation | null = null

const estimatedInstallSize = computed(() => {
  let downloadBytes = 0
  for (const selected of Object.values(selections.value)) {
    const files = selected?.data?.downloadFiles as Array<{ size: number }> | undefined
    if (files) {
      downloadBytes += files.reduce((sum, f) => sum + f.size, 0)
    }
  }
  return downloadBytes > 0 ? Math.ceil(downloadBytes * 2.25) : 0
})

const advancedOpen = ref(false)
const advancedRef = ref<HTMLElement | null>(null)

/** Entrypoint that opened this wizard, for the handoff funnel events (#1224). */
const entrypoint = ref('unknown')
/** Flipped true once this wizard session reaches a TERMINAL handoff outcome:
 *  install.dispatched, dispatch_no_entry, or back_to_local_branch. Guards the
 *  onBeforeUnmount `wizard_cancelled` emit so exactly one *terminal* event
 *  fires per open. `add_installation_failed` is an attempt-level failure - it
 *  intentionally leaves this false so a later retry (-> dispatched) or give-up
 *  (-> wizard_cancelled) is still recorded as the true terminal outcome. */
const resolved = ref(false)

/** Shared context for the install-handoff funnel events (#1224). */
function installHandoffProps(): Record<string, string | boolean | null> {
  const variantId = selections.value.variant?.data?.variantId as string | undefined
  return {
    entrypoint: entrypoint.value,
    source_id: managedBuildMode.value ? 'comfybuilder' : (currentSource.value?.id ?? null),
    variant: variantId ? toVariantBucket(variantId) : null,
    express: false
  }
}

const NO_TEMPLATE_VALUE = 'none'

/** The selected starter template option (excludes the "None" sentinel). */
const selectedTemplate = computed<FieldOption | null>(() => {
  const sel = selections.value.bundledTemplate
  return sel && sel.value !== NO_TEMPLATE_VALUE ? sel : null
})

/** True when the selected template carries a non-zero model download. */
const templateHasModels = computed(() => {
  const size = selectedTemplate.value?.data?.sizeBytes as number | undefined
  return typeof size === 'number' && size > 0
})

const templateIsApiNode = computed(() => isApiNodeTemplate(selectedTemplate.value))

/** Proactive disk guard - shares `isTemplateDiskBlocked` with TemplatePickerStep
 *  so the alert, the disabled Install button, and the save-time hard block can't
 *  drift. */
const templateInstallBlocked = computed(() => {
  if (diskSpaceLoading.value) return false
  const modelBytes = (selectedTemplate.value?.data?.sizeBytes as number | undefined) ?? 0
  return isTemplateDiskBlocked(diskSpace.value, modelBytes)
})

const pickerRef = ref<InstanceType<typeof TemplatePickerStep> | null>(null)

/** Alert state surfaced by the picker, rendered above the card so it's always
 *  visible (never clipped by the card's scroll). */
const templateDiskError = computed(() => pickerRef.value?.shownDiskError ?? null)
const hasTemplateAlerts = computed(() => !!templateDiskError.value)

/** Shake the disk-error alert when a blocked Install is clicked (mirrors the
 *  first-use consent gate). Auto-resets so it can replay on the next click. */
const templateAlertNudge = ref(false)
let templateNudgeTimer: ReturnType<typeof setTimeout> | undefined
function nudgeTemplateAlert(): void {
  templateAlertNudge.value = true
  clearTimeout(templateNudgeTimer)
  templateNudgeTimer = setTimeout(() => {
    templateAlertNudge.value = false
  }, 600)
}

/** Which step of the takeover is showing: Configure, then the (optional,
 *  standalone-only) starter-template picker before install. */
const step = ref<'configure' | 'template'>('configure')
const dontShowTemplatePicker = ref(false)
/** Whether to even offer the picker step: skippable for returning opted-out
 *  users. The "Don't show again" checkbox itself only appears once the user
 *  already has ≥1 local install (a first-ever user always sees the step). */
const pickerEnabled = ref(true)
const hasLocalInstall = ref(false)

const templateOptions = computed<FieldOption[]>(
  () => fieldOptions.value.get('bundledTemplate') ?? []
)

/** Volume can't fit even the smallest model-bearing template (incl. headroom).
 *  When known and true, there's nothing the picker could install, so we skip the
 *  step outright rather than show it with every option blocked. Stays `false`
 *  while disk space is unknown/loading - we only skip on a confirmed shortfall. */
const diskTooSmallForAnyTemplate = computed(() => {
  if (diskSpaceLoading.value || !diskSpace.value) return false
  if (templateOptions.value.some(isApiNodeTemplate)) return false
  const cheapest = minTemplateModelBytes(templateOptions.value.map(templateSizeBytes))
  return isTemplateDiskBlocked(diskSpace.value, cheapest)
})

/** Show the picker step only for the standalone source when it's enabled,
 *  the template field produced options, and the volume can fit at least one
 *  template's models. Gated only by the `skipTemplatePickerStep` user opt-out
 *  (`pickerEnabled`) - shown to everyone on the standalone install path. */
const shouldShowPickerStep = computed(
  () =>
    currentSource.value?.id === 'standalone' &&
    pickerEnabled.value &&
    templateOptions.value.length > 0 &&
    !diskTooSmallForAnyTemplate.value
)

function selectTemplate(option: FieldOption): void {
  const prev = selections.value.bundledTemplate?.value
  selections.value.bundledTemplate = option
  // Emit only on real (non-`None`) picks, and only on a value change so
  // re-clicking the already-selected row doesn't inflate the event count.
  if (option.value !== NO_TEMPLATE_VALUE && option.value !== prev) {
    const sizeBytes = (option.data?.sizeBytes as number | undefined) ?? 0
    emitTelemetryAction('comfy.desktop.template.selected', {
      template_id: option.value,
      size_bucket: toSizeBucket(sizeBytes),
      is_api_node: isApiNodeTemplate(option)
    })
  }
}

/** Configure's primary button: advance to the picker step, or install directly
 *  when the picker is gated off (non-standalone source, no template options,
 *  disk too small, or the `skipTemplatePickerStep` opt-out). */
async function handleConfigureContinue(): Promise<void> {
  if (shouldShowPickerStep.value) {
    // No template is pre-selected - the "None" sentinel stays put until the
    // user actively picks a card, so nobody installs a starter workflow (and
    // its models) they never chose.
    if (instPath.value) fetchDiskSpace(instPath.value)
    step.value = 'template'
    emitTelemetryAction('comfy.desktop.template.picker_shown', {
      template_count: templateOptions.value.length,
      has_local_install: hasLocalInstall.value,
      default_template_id: selections.value.bundledTemplate?.value ?? null
    })
    return
  }
  await handleSave()
}

/** Picker's "Install": persist the opt-out (if ticked) then install. When the
 *  volume can't fit the selected template, shake the disk-error alert instead of
 *  installing (the button stays clickable so the nudge can fire, mirroring the
 *  first-use consent gate). */
async function handleTemplateInstall(): Promise<void> {
  if (templateInstallBlocked.value) {
    nudgeTemplateAlert()
    return
  }
  const tpl = selectedTemplate.value
  emitTelemetryAction('comfy.desktop.template.install_confirmed', {
    template_id: tpl?.value ?? NO_TEMPLATE_VALUE,
    size_bucket: toSizeBucket((tpl?.data?.sizeBytes as number | undefined) ?? 0),
    has_models: templateHasModels.value,
    is_api_node: templateIsApiNode.value,
    dont_show_again: dontShowTemplatePicker.value
  })
  await persistDontShowAgain()
  await handleSave()
}

/** Picker's "Skip & Install": no template, then install. */
async function handleTemplateSkip(): Promise<void> {
  emitTelemetryAction('comfy.desktop.template.skipped', {
    had_template_selected: !!selectedTemplate.value,
    candidate_template_id: selectedTemplate.value?.value ?? null,
    dont_show_again: dontShowTemplatePicker.value
  })
  const none = templateOptions.value.find((o) => o.value === NO_TEMPLATE_VALUE)
  if (none) selections.value.bundledTemplate = none
  await persistDontShowAgain()
  await handleSave()
}

async function persistDontShowAgain(): Promise<void> {
  if (dontShowTemplatePicker.value) {
    try {
      await window.api.setSetting('skipTemplatePickerStep', true)
    } catch {
      // Non-fatal - the step just shows again next time.
    }
  }
}

// Scroll Advanced into view on open. `block: 'nearest'` no-ops when already visible so the view doesn't yank on tall screens.
watch(advancedOpen, async (open) => {
  if (!open) return
  await nextTick()
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  advancedRef.value?.scrollIntoView({
    behavior: reduced ? 'auto' : 'smooth',
    block: 'nearest'
  })
})

watch(instPath, (newPath) => {
  diskSpace.value = null
  pathIssues.value = []
  fetchDiskSpace(newPath)
})

/** Bumped on each open/source change to discard stale responses. */
let loadGeneration = 0
/** Bumped on each open/workspace mode change to discard stale mode initialization. */
let modeGeneration = 0

// Reject whitespace-only names; a truly-blank field is allowed (falls back to the suggested default).
const nameError = computed(() =>
  instName.value.length > 0 && instName.value.trim().length === 0
    ? t('newInstall.nameWhitespace')
    : ''
)

// Mirrors main's `parseUrl`: a scheme-less value is tried as `http://<value>` and must yield a hostname.
function isValidConnectionUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
    return parsed.hostname.length > 0
  } catch {
    return false
  }
}

// Inline error for the `url` field on Remote Connection / Cloud sources; scoped to `id === 'url'` so other text fields keep their own flow.
const urlFieldError = computed(() => {
  const source = currentSource.value
  if (!source) return ''
  const urlField = source.fields.find((f) => f.id === 'url' && f.type === 'text')
  if (!urlField) return ''
  const value = textFieldValues.value.get('url') ?? ''
  return isValidConnectionUrl(value) ? '' : t('newInstall.urlInvalid')
})

// Continue gate. `skipInstall` sources (Remote Connection) have no install path, so the path-issue guard is skipped for them.
const canContinue = computed(() => {
  if (managedBuildMode.value) {
    const targets = selectedBuild.value?.releaseTargets ?? []
    return Boolean(
      selectedBuild.value &&
      (targets.length === 0 || selectedBuildTarget.value) &&
      !nameError.value &&
      pathIssues.value.length === 0
    )
  }
  if (!currentSource.value) return false
  if (nameError.value || urlFieldError.value) return false
  if (currentSource.value.skipInstall) return !saveDisabled.value
  return !saveDisabled.value && pathIssues.value.length === 0
})

/** Deep-strip Vue reactive proxies for safe IPC serialization. */
function rawSelections(): Record<string, FieldOption> {
  const raw = toRaw(selections.value)
  const result: Record<string, FieldOption> = {}
  for (const [key, val] of Object.entries(raw)) {
    result[key] = JSON.parse(JSON.stringify(toRaw(val))) as FieldOption
  }
  return result
}

let installDirPromise: Promise<string> | null = null
let sourcesPromise: Promise<Source[]> | null = null

const brandShellRef = ref<HTMLElement | null>(null)
let returnFocusTo: HTMLElement | null = null

onMounted(() => {
  if (props.hideBackToDashboard) {
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void nextTick(() => {
      const target = brandShellRef.value?.querySelector<HTMLElement>(
        'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      target?.focus()
    })
  }

  window.api
    .detectGPU()
    .then((gpu) => {
      if (gpu) {
        detectedGpu.value = t('newInstall.detectedGpu', { label: gpu.label })
      } else {
        detectedGpu.value = t('newInstall.noGpuDetected')
      }
    })
    .catch(() => {
      detectedGpu.value = t('newInstall.noGpuDetected')
    })

  installDirPromise = window.api.getDefaultInstallDir().catch(() => '')
  sourcesPromise = window.api.getSources()
})

onBeforeUnmount(() => {
  // Onboarding->install drop-off (#1224): the wizard is unmounting without a
  // resolved handoff outcome, so the user left the install path without
  // dispatching. `skipInstall` sources (Remote Connection) never install, so
  // they're not part of this funnel. The happy-path dispatch, the defensive
  // no-entry close, and the Back-to-onboarding navigation all set `resolved`
  // first, so this only catches genuine abandonment (✕ / dismiss).
  if (!resolved.value && !currentSource.value?.skipInstall) {
    emitTelemetryAction('comfy.desktop.install.not_started', {
      ...installHandoffProps(),
      reason: 'wizard_cancelled'
    })
  }
  if (returnFocusTo && document.contains(returnFocusTo)) {
    returnFocusTo.focus()
  }
  returnFocusTo = null
  clearTimeout(templateNudgeTimer)
})

/** Configure footer Back link (first-use chain only). Records that install
 *  didn't start here and marks the outcome resolved so the unmount that
 *  follows doesn't also report `wizard_cancelled`. */
function handleBackToLocalBranch(): void {
  resolved.value = true
  emitTelemetryAction('comfy.desktop.install.not_started', {
    ...installHandoffProps(),
    reason: 'back_to_local_branch'
  })
  emit('back-to-local-branch')
}

interface OpenOpts {
  /** Set when opened via the first-use localBranch -> Start Fresh path; surfaces a Back link that returns to localBranch instead of closing. */
  cameFromLocalBranch?: boolean
  /** Where this wizard was opened from (`first_use`, `chooser`, `titlebar`, `url`); carried onto the install.dispatched / install.not_started funnel events. */
  entrypoint?: string
  /** Active workspace whose compatible Builds replace the generic source controls. */
  workspaceId?: string
}

const cameFromLocalBranch = ref(false)

async function open(opts: OpenOpts = {}): Promise<void> {
  loadGeneration++
  const gen = ++modeGeneration
  instName.value = ''
  workspaceId.value = opts.workspaceId?.trim() || null
  workspaceInstallMode.value = 'managed'
  selectedBuildId.value = ''
  selectedBuildTargetId.value = ''
  advancedOpen.value = false
  cameFromLocalBranch.value = opts.cameFromLocalBranch === true
  entrypoint.value = opts.entrypoint ?? 'unknown'
  resolved.value = false
  suggestedName.value = ''
  instPath.value = ''
  selections.value = {}
  currentSource.value = null
  saveDisabled.value = true
  fieldOptions.value.clear()
  fieldLoading.value.clear()
  fieldErrors.value.clear()
  textFieldValues.value.clear()

  detectedGpu.value = t('newInstall.detectingGpu')
  hardwareWarning.value = ''
  resetDiskSpace()
  sourceError.value = ''
  authorizingWorkspace.value = false
  initializing.value = true
  step.value = 'configure'
  dontShowTemplatePicker.value = false
  // Reset to defaults synchronously so a slow prior-open response can't leave
  // stale gating on this open; the guarded callbacks below then refill them.
  pickerEnabled.value = true
  hasLocalInstall.value = false

  try {
    await initializeInstallMode(gen)
  } finally {
    if (gen === modeGeneration) initializing.value = false
  }
}

async function initializeInstallMode(gen: number): Promise<void> {
  const installDir = await installDirPromise
  if (gen !== modeGeneration) return
  defaultInstPath.value = installDir ?? ''
  instPath.value = defaultInstPath.value

  if (managedBuildMode.value) await initializeManagedBuilds(gen)
  else await initializeLocalInstall(gen)
}

async function initializeManagedBuilds(gen: number): Promise<void> {
  const targetWorkspaceId = workspaceId.value
  if (!targetWorkspaceId) return
  try {
    let status = authStore.status
    if (status.workspaceId !== targetWorkspaceId) {
      authorizingWorkspace.value = true
      try {
        status = await authStore.switchWorkspace(targetWorkspaceId)
      } finally {
        if (gen === modeGeneration) authorizingWorkspace.value = false
      }
    }
    if (gen !== modeGeneration || !managedBuildMode.value) return
    if (!status.signedIn || status.workspaceId !== targetWorkspaceId) {
      emit('close')
      return
    }
    if (!authStore.buildsLoaded) await authStore.fetchBuilds()
    if (gen !== modeGeneration || !managedBuildMode.value) return
    selectedBuildId.value = workspaceBuilds.value[0]?.id ?? ''
    suggestManagedBuildName(selectedBuild.value)
  } catch {
    if (gen === modeGeneration && managedBuildMode.value) emit('close')
  }
}

async function initializeLocalInstall(gen: number): Promise<void> {
  void window.api
    .getUniqueName(DEFAULT_INSTALL_NAME)
    .then((name) => {
      if (gen === modeGeneration && localInstallMode.value) suggestedName.value = name
    })
    .catch(() => {})

  // These are needed only if the user reaches the later template step, so they
  // run in the background and never block the Configure screen's first paint.
  void window.api
    .getSetting('skipTemplatePickerStep')
    .then((skip) => {
      if (gen === modeGeneration && localInstallMode.value) pickerEnabled.value = skip !== true
    })
    .catch(() => {})
  void window.api
    .getInstallationsSummary()
    .then((summary) => {
      if (gen === modeGeneration && localInstallMode.value) {
        hasLocalInstall.value = summary.localCount > 0
      }
    })
    .catch(() => {})

  await loadSources()
  if (gen !== modeGeneration || !localInstallMode.value) return

  // Pre-select Standalone (the recommended method); other sources remain
  // reachable through the same Advanced controls used outside workspaces.
  hardwareValidation = await window.api.validateHardware()
  if (gen !== modeGeneration || !localInstallMode.value) return
  hardwareWarning.value = hardwareValidation.warning ?? ''
  const standalone = sources.value.find((source) => source.id === 'standalone')
  if (standalone && hardwareValidation.supported) {
    await selectSourceCard(standalone)
  } else if (standalone) {
    detectedGpu.value = hardwareValidation.error || t('newInstall.noGpuDetected')
  }
}

async function selectWorkspaceInstallMode(mode: 'managed' | 'public'): Promise<void> {
  if (!workspaceMode.value || workspaceInstallMode.value === mode) return
  authorizingWorkspace.value = false
  workspaceInstallMode.value = mode
  step.value = 'configure'
  suggestedName.value = ''
  const gen = ++modeGeneration
  initializing.value = true
  try {
    await initializeInstallMode(gen)
  } finally {
    if (gen === modeGeneration) initializing.value = false
  }
}

async function loadSources(): Promise<void> {
  if (sources.value.length > 0) return
  sourcesLoading.value = true
  try {
    sources.value = sourcesPromise ? await sourcesPromise : await window.api.getSources()
  } finally {
    sourcesLoading.value = false
  }
}

async function selectSourceCard(source: Source): Promise<void> {
  if (currentSource.value?.id === source.id) return

  if (source.id === 'standalone' && hardwareValidation && !hardwareValidation.supported) {
    trackGuardrailBlocked('unsupported_hw', 'wizard', 'source_select')
    await modal.alert({
      title: t('newInstall.unsupportedHardwareTitle'),
      message: hardwareValidation.error || ''
    })
    return
  }

  await selectSource(source)
  emitTelemetryAction('comfy.desktop.install.method.selected', {
    source_id: source.id,
    source_category: source.category || source.id,
    flow: 'wizard'
  })
}

async function selectSource(source: Source): Promise<void> {
  loadGeneration++
  currentSource.value = source
  // A different source can't keep the (standalone-only) picker open.
  step.value = 'configure'
  selections.value = {}
  fieldOptions.value.clear()
  fieldLoading.value.clear()
  fieldErrors.value.clear()
  textFieldValues.value.clear()
  saveDisabled.value = true
  sourceError.value = ''

  for (const f of source.fields) {
    if (f.type === 'text') {
      const defaultVal = f.defaultValue ?? ''
      textFieldValues.value.set(f.id, defaultVal)
      if (f.defaultValue !== undefined) {
        selections.value[f.id] = { value: f.defaultValue, label: f.defaultValue }
      }
    }
  }

  // Start loading from the first loadable (non-text) field
  const firstLoadable = source.fields.findIndex((f) => f.type !== 'text')
  if (firstLoadable >= 0) {
    await loadFieldOptions(firstLoadable)
  }

  // Sources with only text fields and skipInstall can be saved immediately
  if (source.skipInstall && source.fields.every((f) => f.type === 'text')) {
    saveDisabled.value = false
  }
}

async function loadFieldOptions(fieldIndex: number): Promise<void> {
  const source = currentSource.value
  if (!source) return
  const field = source.fields[fieldIndex]
  if (!field) return

  const gen = loadGeneration

  fieldLoading.value.set(field.id, true)
  fieldOptions.value.delete(field.id)
  saveDisabled.value = true

  // Clear downstream select fields
  for (let i = fieldIndex + 1; i < source.fields.length; i++) {
    const df = source.fields[i]
    if (!df || df.type === 'text') continue
    fieldOptions.value.delete(df.id)
    fieldLoading.value.set(df.id, false)
    delete selections.value[df.id]
  }

  // Clear any previous error on the error target field
  const clearTarget =
    field.errorTarget ||
    (() => {
      for (let i = fieldIndex - 1; i >= 0; i--) {
        const sf = source.fields[i]
        if (sf?.type === 'text') return sf.id
      }
      return null
    })()
  if (clearTarget) {
    fieldErrors.value.delete(clearTarget)
  }

  try {
    const options = await window.api.getFieldOptions(
      source.id,
      field.id,
      rawSelections(),
      field.id === 'release' ? { includeLatestStable: true } : undefined
    )

    // Discard stale response if source/modal changed during the await
    if (gen !== loadGeneration) return

    fieldLoading.value.set(field.id, false)
    fieldOptions.value.set(field.id, options)

    if (options.length > 0) {
      // The starter-template field must never default to a `recommended` pick
      // (e.g. MiniMax) — that pre-selects a workflow, and the models it pulls
      // in, before the user has chosen anything. It always defaults to the
      // "None" sentinel (index 0; see `standalone/index.ts`), same as every
      // other field falls back to index 0 when nothing is `recommended`.
      let defaultIndex =
        field.id === 'bundledTemplate' ? 0 : options.findIndex((opt) => opt.recommended)
      if (defaultIndex < 0) defaultIndex = 0
      const defaultOption = options[defaultIndex]
      if (defaultOption) selections.value[field.id] = defaultOption
    } else {
      // Conditional fields (e.g. `comfyVersion` on the 'latest' channel) return
      // [] when not applicable. Drop any stale selection so a value from a
      // prior channel toggle doesn't leak into `buildInstallation`.
      delete selections.value[field.id]
    }

    // Load next select field. An empty-options field still hands off downstream
    // so a conditional field can't strand the chain (would leave Continue disabled).
    const nextSelect = source.fields.findIndex((f, i) => i > fieldIndex && f.type !== 'text')
    if (nextSelect >= 0) {
      await loadFieldOptions(nextSelect)
    } else {
      saveDisabled.value = false
    }
  } catch (err: unknown) {
    if (gen !== loadGeneration) return
    fieldLoading.value.set(field.id, false)
    const errMsg = (err as Error).message || String(err)

    // Show error on the declared errorTarget, or fall back to preceding text field
    let errorFieldId = field.errorTarget
    if (!errorFieldId) {
      for (let i = fieldIndex - 1; i >= 0; i--) {
        const sf = source.fields[i]
        if (sf?.type === 'text') {
          errorFieldId = sf.id
          break
        }
      }
    }
    if (errorFieldId) {
      fieldErrors.value.set(errorFieldId, errMsg)
    } else if (field.renderAs === 'cards' || field.type === 'select') {
      sourceError.value = errMsg
    } else {
      fieldErrors.value.set(field.id, errMsg)
    }
  }
}

function handleFieldSelectChange(field: SourceField, fieldIndex: number, value: string): void {
  const source = currentSource.value
  if (!source) return
  const options = fieldOptions.value.get(field.id)
  if (!options) return

  const idx = parseInt(value, 10)
  const selected = options[idx]
  if (selected) selections.value[field.id] = selected

  const nextSelect = source.fields.findIndex((f, i) => i > fieldIndex && f.type !== 'text')
  if (nextSelect >= 0) {
    loadFieldOptions(nextSelect)
  } else {
    saveDisabled.value = false
  }
}

function selectCardOption(field: SourceField, fieldIndex: number, option: FieldOption): void {
  selections.value[field.id] = option
  if (field.id === 'variant') {
    emitTelemetryAction('comfy.desktop.install.variant.selected', {
      variant_bucket: toVariantBucket(
        (option.data?.variantId as string | undefined) || option.value
      ),
      recommended: !!option.recommended,
      flow: 'wizard'
    })
  }

  const source = currentSource.value
  if (!source) return
  const nextSelect = source.fields.findIndex((f, i) => i > fieldIndex && f.type !== 'text')
  if (nextSelect >= 0) {
    loadFieldOptions(nextSelect)
  } else {
    saveDisabled.value = false
  }
}

function handleTextAction(field: SourceField): void {
  const source = currentSource.value
  if (!source) return
  const value = textFieldValues.value.get(field.id) ?? ''

  fieldErrors.value.delete(field.id)
  selections.value[field.id] = { value, label: value }

  const fieldIndex = source.fields.findIndex((f) => f.id === field.id)
  const nextLoadable = source.fields.findIndex((f, i) => i > fieldIndex && f.type !== 'text')
  if (nextLoadable >= 0) {
    loadFieldOptions(nextLoadable)
  }
}

async function handleBrowse(): Promise<void> {
  const chosen = await window.api.browseFolder(instPath.value)
  if (chosen) instPath.value = chosen
}

function handleOpenInstPath(): void {
  if (instPath.value) void window.api.openPath(instPath.value)
}

function openBuildsPage(): void {
  if (!workspaceId.value) return
  void window.api.comfybuilder.openBuildsPage(workspaceId.value).catch(() => {})
}

async function validateSelectedInstallRoot(): Promise<boolean> {
  if (!instPath.value) return true
  try {
    const issues = await window.api.validateInstallPath(instPath.value)
    return showPathIssueAlerts(issues, 'wizard', 'save', modal.alert, t)
  } catch {
    return true
  }
}

async function handOffInstall(
  result: InstallBuildResult,
  failureTitle: string,
  templateSelected: boolean
): Promise<void> {
  if (!result.ok) {
    emitTelemetryAction('comfy.desktop.install.not_started', {
      ...installHandoffProps(),
      reason: 'add_installation_failed',
      error_bucket: toErrorBucket(result.message || '')
    })
    await modal.alert({ title: failureTitle, message: result.message || '' })
    return
  }
  if (result.entry) {
    resolved.value = true
    emitTelemetryAction('comfy.desktop.install.dispatched', {
      ...installHandoffProps(),
      installation_id: result.entry.id,
      template_selected: templateSelected
    })
    emit('show-progress', {
      installationId: result.entry.id,
      title: `${t('newInstall.installing')} - ${result.entry.name}`,
      apiCall: () => window.api.installInstance(result.entry!.id),
      autoLaunchOnFinish: true,
      opKind: 'install'
    })
    return
  }
  resolved.value = true
  emitTelemetryAction('comfy.desktop.install.not_started', {
    ...installHandoffProps(),
    reason: 'dispatch_no_entry',
    installation_id: null
  })
  emit('close')
}

async function handleWorkspaceBuildSave(): Promise<void> {
  const build = selectedBuild.value
  if (!build || !(await validateSelectedInstallRoot())) return
  const result = await window.api.comfybuilder
    .installBuild({
      buildId: build.id,
      ...(selectedBuildTarget.value
        ? {
            artifactId: selectedBuildTarget.value.artifactId,
            releaseVersion: selectedBuildTarget.value.releaseVersion
          }
        : {}),
      ...(instName.value.trim() ? { name: instName.value.trim() } : {}),
      ...(instPath.value.trim() ? { installRoot: instPath.value.trim() } : {})
    })
    .catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }))
  await handOffInstall(result, t('errors.installFailed'), false)
}

async function handleSave(): Promise<void> {
  if (managedBuildMode.value) {
    await handleWorkspaceBuildSave()
    return
  }
  const source = currentSource.value
  if (!source) return

  // Warn if NVIDIA driver is too old for the bundled PyTorch
  if (source.id === 'standalone') {
    const variantId = selections.value.variant?.data?.variantId as string | undefined
    if (variantId && stripVariantPrefix(variantId).startsWith('nvidia')) {
      if (!(await checkNvidiaDriverOrWarn('wizard', 'save', modal.confirm, t))) {
        return
      }
    }
  }

  // Sync text field values into selections before building
  for (const f of source.fields) {
    if (f.type === 'text') {
      const value = textFieldValues.value.get(f.id) ?? ''
      selections.value[f.id] = { value, label: value }
    }
  }

  // Note: the starter-template model download is gated entirely by the chosen
  // `bundledTemplate` - `buildInstallation` sets `downloadTemplateModels` from
  // the template id, so "Skip & Install" (template = None) means no download.
  // The renderer doesn't sync a separate consent field.

  const instData = await window.api.buildInstallation(source.id, rawSelections())
  const baseName = instName.value.trim() || DEFAULT_INSTALL_NAME
  const name = await window.api.getUniqueName(baseName)

  if (source.skipInstall) {
    const result = await window.api.addInstallation({
      name,
      installPath: '',
      status: 'installed',
      ...instData
    })
    if (!result.ok) {
      await modal.alert({
        title: t('errors.cannotAdd'),
        message: result.message || ''
      })
      return
    }
    emit('close')
    emit('navigate-list')
    return
  }

  if (!(await validateSelectedInstallRoot())) return

  // Check disk space before proceeding
  if (instPath.value) {
    try {
      const downloadFiles = selections.value.variant?.data?.downloadFiles as
        | Array<{ size: number }>
        | undefined
      const downloadBytes = downloadFiles ? downloadFiles.reduce((sum, f) => sum + f.size, 0) : 0
      const estimatedRequired = downloadBytes > 0 ? Math.ceil(downloadBytes * 2.25) : 0

      if (
        !(await checkDiskSpaceOrWarn({
          path: instPath.value,
          estimatedRequired,
          flow: 'wizard',
          confirm: modal.confirm,
          t
        }))
      ) {
        return
      }
    } catch {
      // If disk space check fails, proceed anyway
    }
  }

  // Hard-block when the volume can't hold the selected template's models.
  if (instPath.value && templateHasModels.value) {
    const modelBytes = (selectedTemplate.value?.data?.sizeBytes as number | undefined) ?? 0
    if (
      !(await checkTemplateDiskOrBlock({
        path: instPath.value,
        estimatedModelBytes: modelBytes,
        flow: 'wizard',
        alert: modal.alert,
        t
      }))
    ) {
      return
    }
  }

  const result = await window.api.addInstallation({
    name,
    installPath: instPath.value,
    ...instData
  })
  await handOffInstall(result, t('errors.cannotAdd'), templateHasModels.value)
}

function getSelectOptions(field: SourceField): BaseSelectOption[] {
  const options = fieldOptions.value.get(field.id)
  if (!options) return []
  return options.map((opt) => ({
    value: opt.value,
    label: opt.recommended ? `${opt.label} (${t('newInstall.recommended')})` : opt.label,
    description: opt.description
  }))
}

function getSelectPlaceholder(field: SourceField): string {
  if (fieldLoading.value.get(field.id)) return t('newInstall.loading')
  const err = fieldErrors.value.get(field.id)
  if (err) return `Error: ${err}`
  if (fieldOptions.value.has(field.id)) return t('newInstall.noOptions')
  return '--'
}

function onSelectFieldChange(field: SourceField, fieldIndex: number, value: string): void {
  const options = fieldOptions.value.get(field.id)
  if (!options) return
  const idx = options.findIndex((o) => o.value === value)
  if (idx < 0) return
  handleFieldSelectChange(field, fieldIndex, String(idx))
}

/** Conditional fields like `comfyVersion` (only meaningful on the stable
 *  channel) return an empty options array when not applicable. Hide them
 *  outright so the wizard doesn't render a "No options" dropdown. */
function isHiddenWhenEmpty(field: SourceField): boolean {
  // The starter-template field gets its own dedicated step when the picker is
  // enabled - hide its Advanced-section card so it isn't shown twice. (When the
  // picker is gated off, the Advanced card stays as the fallback.)
  if (field.id === 'bundledTemplate' && shouldShowPickerStep.value) return true
  if (field.type === 'text' || field.renderAs === 'cards') return false
  const options = fieldOptions.value.get(field.id)
  if (options === undefined) return false
  return options.length === 0 && !fieldLoading.value.get(field.id)
}

defineExpose({ open })
</script>

<template>
  <BrandTakeoverLayout>
    <div v-if="step === 'configure'" ref="brandShellRef" class="config-shell">
      <h1 class="brand-title">{{ $t('newInstall.configureTitle') }}</h1>
      <p class="brand-lead">
        {{ $t(managedBuildMode ? 'newInstall.configureWorkspaceLead' : 'chooser.newInstallDesc') }}
      </p>
      <div class="config-card">
        <div class="config-card__body">
          <div
            v-if="authorizingWorkspace"
            class="workspace-authorization-status with-spinner"
            role="status"
            data-testid="workspace-authorization-status"
          >
            {{ $t('newInstall.waitingForWorkspaceAuthorization') }}
          </div>
          <div class="config-field">
            <label class="config-label" for="inst-name-standalone">{{ $t('common.name') }}</label>
            <div class="brand-input" :class="{ 'brand-input--invalid': nameError }">
              <input
                id="inst-name-standalone"
                :value="instName"
                type="text"
                :placeholder="suggestedName || $t('common.namePlaceholder')"
                :aria-invalid="!!nameError"
                :aria-describedby="nameError ? 'inst-name-error' : undefined"
                @input="instName = ($event.target as HTMLInputElement).value"
              />
            </div>
            <div v-if="nameError" id="inst-name-error" class="field-error" role="alert">
              {{ nameError }}
            </div>
          </div>

          <div
            v-if="workspaceMode"
            class="config-field"
            data-testid="workspace-install-source-field"
          >
            <span id="workspace-install-source-label" class="config-label">
              {{ $t('newInstall.buildSourceLabel') }}
            </span>
            <div
              class="workspace-install-source"
              role="radiogroup"
              aria-labelledby="workspace-install-source-label"
            >
              <button
                type="button"
                role="radio"
                data-testid="workspace-install-source-managed"
                :aria-checked="workspaceInstallMode === 'managed'"
                :class="{ 'is-selected': workspaceInstallMode === 'managed' }"
                @click="selectWorkspaceInstallMode('managed')"
              >
                {{ $t('newInstall.managedBuilds') }}
              </button>
              <button
                type="button"
                role="radio"
                data-testid="workspace-install-source-public"
                :aria-checked="workspaceInstallMode === 'public'"
                :class="{ 'is-selected': workspaceInstallMode === 'public' }"
                @click="selectWorkspaceInstallMode('public')"
              >
                {{ $t('newInstall.publicBuilds') }}
              </button>
            </div>
          </div>

          <!-- GPU + Install Location stay visible but are disabled in Remote Connection mode (no local hardware / path). -->
          <TooltipWrap
            class="config-field-wrap"
            side="bottom"
            :text="currentSource?.skipInstall ? $t('newInstall.notAvailableRemote') : ''"
          >
            <div
              class="config-field"
              :class="{ 'config-field--disabled': currentSource?.skipInstall }"
            >
              <label class="config-label">{{ $t('newInstall.detectedGpuLabel') }}</label>
              <div
                class="brand-input config-select config-select--readonly"
                role="textbox"
                aria-readonly="true"
              >
                <span class="config-select__value">{{ detectedGpu }}</span>
              </div>
              <div
                v-if="hardwareWarning && !currentSource?.skipInstall"
                class="config-gpu-warning"
                role="alert"
                data-testid="wizard-hardware-warning"
              >
                {{ hardwareWarning }}
              </div>
            </div>
          </TooltipWrap>

          <TooltipWrap
            class="config-field-wrap"
            side="bottom"
            :text="currentSource?.skipInstall ? $t('newInstall.notAvailableRemote') : ''"
          >
            <div
              class="config-field"
              :class="{ 'config-field--disabled': currentSource?.skipInstall }"
            >
              <label class="config-label">{{ $t('newInstall.installLocation') }}</label>
              <div class="config-path-row">
                <div class="brand-input config-path-input">
                  <HardDrive :size="14" aria-hidden="true" />
                  <button
                    v-if="!currentSource?.skipInstall && instPath"
                    type="button"
                    class="open-folder-link config-path-open"
                    :title="$t('actions.openDirectory', 'Open Directory')"
                    :aria-label="`${$t('actions.openDirectory', 'Open Directory')}: ${instPath}`"
                    @click="handleOpenInstPath"
                  >
                    {{ instPath }}
                  </button>
                  <span v-else class="open-folder-link config-path-open config-path-open--static">{{
                    instPath
                  }}</span>
                </div>
                <button
                  class="brand-tertiary"
                  type="button"
                  :disabled="!!currentSource?.skipInstall"
                  @click="handleBrowse"
                >
                  {{ $t('common.browse') }}
                </button>
              </div>
              <PathDiskInfo
                v-if="!currentSource?.skipInstall"
                :path-issues="pathIssues"
                :disk-space-loading="diskSpaceLoading"
                :disk-space="diskSpace"
                :estimated-size="estimatedInstallSize"
              />
            </div>
          </TooltipWrap>

          <div v-if="managedBuildMode" class="config-field" data-testid="workspace-build-field">
            <div class="workspace-build-label-row">
              <label class="config-label">{{ $t('newInstall.workspaceBuildLabel') }}</label>
              <div class="workspace-build-actions">
                <button
                  type="button"
                  class="workspace-build-online"
                  :disabled="initializing"
                  @click="openBuildsPage"
                >
                  {{ $t('newInstall.viewBuildsOnline') }}
                </button>
                <button
                  type="button"
                  class="workspace-build-refresh"
                  :title="$t('newInstall.refreshWorkspaceBuilds')"
                  :aria-label="$t('newInstall.refreshWorkspaceBuilds')"
                  :disabled="authStore.loadingBuilds"
                  @click="authStore.fetchBuilds()"
                >
                  <RefreshCw
                    :size="14"
                    :class="{ 'workspace-build-refresh__icon--spinning': authStore.loadingBuilds }"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <BaseSelect
              v-model="selectedBuildId"
              :options="workspaceBuildOptions"
              :placeholder="$t('newInstall.selectWorkspaceBuild')"
              :loading="authStore.loadingBuilds"
              :loading-label="$t('newInstall.refreshingWorkspaceBuilds')"
              :disabled="workspaceBuildOptions.length === 0"
              :aria-label="$t('newInstall.workspaceBuildLabel')"
            />
            <div
              v-if="selectedBuild"
              class="workspace-build-details"
              data-testid="workspace-build-details"
            >
              <p v-if="selectedBuild.description" class="workspace-build-description">
                {{ selectedBuild.description }}
              </p>
              <dl class="workspace-build-metadata">
                <div v-for="item in selectedBuildMetadata" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </div>
              </dl>
            </div>
            <button
              v-if="authStore.buildsError"
              type="button"
              class="wizard-error wizard-build-retry"
              :disabled="authStore.loadingBuilds"
              @click="authStore.fetchBuilds()"
            >
              {{ $t('devPlatform.build.loadError') }}
            </button>
            <div
              v-else-if="
                !authorizingWorkspace &&
                !authStore.loadingBuilds &&
                workspaceBuildOptions.length === 0
              "
              class="wizard-loading"
            >
              {{ $t('newInstall.noCompatibleBuilds') }}
            </div>
          </div>

          <div
            v-if="managedBuildMode && selectedBuildTargetOptions.length > 0"
            ref="advancedRef"
            class="config-advanced"
            :class="{ 'is-open': advancedOpen }"
            data-testid="workspace-build-advanced"
          >
            <button
              type="button"
              class="config-advanced__summary"
              :aria-expanded="advancedOpen"
              @click="advancedOpen = !advancedOpen"
            >
              <ChevronRight :size="14" class="config-advanced__chevron" aria-hidden="true" />
              <span>{{ $t('common.advanced') }}</span>
            </button>
            <div class="config-advanced__wrap">
              <div class="config-advanced__body">
                <label class="config-label">{{ $t('newInstall.buildTarget') }}</label>
                <BrandVariantList
                  :options="selectedBuildTargetOptions"
                  :selected-value="selectedBuildTargetId"
                  :aria-label="$t('newInstall.buildTarget')"
                  @select="selectedBuildTargetId = $event.value"
                />
              </div>
            </div>
          </div>

          <div
            v-if="!managedBuildMode"
            ref="advancedRef"
            class="config-advanced"
            :class="{ 'is-open': advancedOpen }"
          >
            <button
              type="button"
              class="config-advanced__summary"
              :aria-expanded="advancedOpen"
              @click="advancedOpen = !advancedOpen"
            >
              <ChevronRight :size="14" class="config-advanced__chevron" aria-hidden="true" />
              <span>{{ $t('common.advanced') }}</span>
            </button>
            <div class="config-advanced__wrap">
              <div class="config-advanced__body">
                <div
                  v-if="sources.length > 1"
                  class="config-method-row"
                  role="radiogroup"
                  :aria-label="$t('newInstall.chooseMethod')"
                >
                  <button
                    v-for="s in sources"
                    :key="s.id"
                    type="button"
                    role="radio"
                    :aria-checked="currentSource?.id === s.id"
                    :class="['brand-pill', { 'brand-pill--selected': currentSource?.id === s.id }]"
                    @click="selectSourceCard(s)"
                  >
                    <span>{{ s.label }}</span>
                    <span v-if="s.id === 'standalone'" class="brand-tag-recommended">
                      {{ $t('newInstall.recommended') }}
                    </span>
                  </button>
                </div>
                <div v-if="sourceError" class="wizard-error">{{ sourceError }}</div>
                <div v-if="currentSource" id="source-fields">
                  <div
                    v-for="(field, fieldIndex) in currentSource.fields"
                    v-show="!isHiddenWhenEmpty(field)"
                    :key="field.id"
                    class="field"
                  >
                    <label :for="`sf-${field.id}`">{{ field.label }}</label>

                    <template v-if="field.type === 'text'">
                      <div class="path-input">
                        <div
                          class="brand-input config-source-text"
                          :class="{
                            'brand-input--invalid': field.id === 'url' && urlFieldError
                          }"
                        >
                          <input
                            :id="`sf-${field.id}`"
                            type="text"
                            :value="textFieldValues.get(field.id) ?? ''"
                            :placeholder="field.defaultValue || ''"
                            :aria-invalid="field.id === 'url' && !!urlFieldError"
                            :aria-describedby="
                              field.id === 'url' && urlFieldError
                                ? `sf-${field.id}-error`
                                : undefined
                            "
                            @input="
                              textFieldValues.set(
                                field.id,
                                ($event.target as HTMLInputElement).value
                              )
                            "
                          />
                        </div>
                        <button
                          v-if="field.action"
                          :id="`sf-${field.id}-action`"
                          type="button"
                          class="brand-tertiary"
                          @click="handleTextAction(field)"
                        >
                          {{ field.action.label }}
                        </button>
                      </div>
                      <div v-if="fieldErrors.get(field.id)" class="field-error">
                        {{ fieldErrors.get(field.id) }}
                      </div>
                      <div
                        v-else-if="field.id === 'url' && urlFieldError"
                        :id="`sf-${field.id}-error`"
                        class="field-error"
                        role="alert"
                      >
                        {{ urlFieldError }}
                      </div>
                    </template>

                    <template v-else-if="field.renderAs === 'cards'">
                      <div v-if="fieldLoading.get(field.id)" class="wizard-loading with-spinner">
                        {{ $t('newInstall.loading') }}
                      </div>
                      <BrandVariantList
                        v-else-if="
                          fieldOptions.has(field.id) &&
                          (fieldOptions.get(field.id)?.length ?? 0) > 0
                        "
                        :options="sortedCardOptions(fieldOptions.get(field.id)!)"
                        :selected-value="selections[field.id]?.value ?? null"
                        :aria-label="field.label"
                        @select="(opt) => selectCardOption(field, fieldIndex, opt)"
                      />
                      <div v-else-if="fieldOptions.has(field.id)" class="wizard-loading">
                        {{
                          fieldErrors.get(field.id)
                            ? `Error: ${fieldErrors.get(field.id)}`
                            : $t('newInstall.noOptions')
                        }}
                      </div>
                    </template>

                    <template v-else>
                      <BaseSelect
                        :model-value="selections[field.id]?.value ?? ''"
                        :options="getSelectOptions(field)"
                        :placeholder="getSelectPlaceholder(field)"
                        :disabled="
                          fieldLoading.get(field.id) ||
                          !fieldOptions.has(field.id) ||
                          (fieldOptions.get(field.id)?.length ?? 0) === 0
                        "
                        :aria-label="field.label"
                        @update:model-value="onSelectFieldChange(field, fieldIndex, $event)"
                      />
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="config-card__footer">
          <button
            v-if="cameFromLocalBranch"
            type="button"
            class="brand-ghost config-back"
            data-testid="config-back-to-local-branch"
            @click="handleBackToLocalBranch"
          >
            {{ $t('common.back') }}
          </button>
          <button
            class="brand-primary config-continue"
            :disabled="!canContinue"
            @click="handleConfigureContinue"
          >
            {{ $t('common.continue') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Dedicated starter-template picker step (after Configure, before install). -->
    <div v-else-if="step === 'template'" class="template-shell">
      <h1 class="brand-title">{{ $t('standalone.templatePickerTitle') }}</h1>
      <p class="brand-lead">{{ $t('standalone.templatePickerLead') }}</p>
      <div
        v-if="hasTemplateAlerts"
        id="tps-alerts"
        class="template-alerts"
        :class="{ 'template-alerts--nudge': templateAlertNudge }"
      >
        <div v-if="templateDiskError" class="template-alert template-alert--error" role="alert">
          <CircleAlert :size="16" aria-hidden="true" />
          <span>{{ templateDiskError }}</span>
        </div>
      </div>
      <div class="brand-card template-card">
        <div class="brand-card__body template-card__body">
          <TemplatePickerStep
            ref="pickerRef"
            :options="templateOptions"
            :none-value="NO_TEMPLATE_VALUE"
            :selected-value="selections.bundledTemplate?.value ?? null"
            :disk-space="diskSpace"
            :disk-space-loading="diskSpaceLoading"
            @select="selectTemplate"
          />
        </div>
        <div class="brand-card__footer template-card__footer">
          <div class="template-card__footer-actions">
            <button
              type="button"
              class="brand-ghost template-skip"
              :aria-label="$t('standalone.templateSkipAndInstallAria')"
              @click="handleTemplateSkip"
            >
              {{ $t('standalone.templateSkipAndInstall') }}
            </button>
            <button
              type="button"
              class="brand-primary template-install"
              :class="{ 'template-install--blocked': templateInstallBlocked }"
              :aria-disabled="templateInstallBlocked"
              :aria-describedby="templateInstallBlocked ? 'tps-alerts' : undefined"
              @click="handleTemplateInstall"
            >
              {{ $t('standalone.templateInstall') }}
            </button>
          </div>
        </div>
      </div>
      <label v-if="hasLocalInstall" class="brand-checkbox template-shell__opt-out">
        <input v-model="dontShowTemplatePicker" type="checkbox" />
        <span class="brand-checkbox__text">{{ $t('standalone.templateDontShowAgain') }}</span>
      </label>
    </div>

    <template #footer-left>
      <TakeoverBack
        v-if="step === 'template'"
        class="config-back-to-dashboard"
        :label="$t('common.back')"
        @back="step = 'configure'"
      />
      <TakeoverBack
        v-else-if="!hideBackToDashboard"
        class="config-back-to-dashboard"
        :label="$t('common.backToDashboard')"
        @back="emit('close')"
      />
    </template>
  </BrandTakeoverLayout>
</template>

<style scoped>
.config-shell {
  align-self: stretch;
  height: 100%;
  max-height: 100%;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding-block: clamp(1.5rem, 4vh, 3rem);
  min-height: 0;
}
.config-shell > .brand-lead {
  margin: var(--takeover-gap-sm) 0 var(--takeover-gap-md);
}

.template-shell {
  align-self: stretch;
  height: 100%;
  max-height: 100%;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding-block: clamp(1.5rem, 4vh, 3rem);
  min-height: 0;
}
.template-card {
  width: 100%;
  max-height: min(80vh, 100%);
}
.template-alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-bottom: 12px;
  text-align: left;
}
.template-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: var(--takeover-fs-caption);
  line-height: 1.4;
}
.template-alert svg {
  flex: 0 0 auto;
  margin-top: 1px;
}
.template-alert--error {
  color: var(--danger);
  background: color-mix(in oklab, var(--danger) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--danger) 28%, transparent);
}
.template-alert--warn {
  color: var(--warning);
  background: color-mix(in oklab, var(--warning) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--warning) 26%, transparent);
}
.template-alerts--nudge {
  animation: template-alert-shake 400ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}
@keyframes template-alert-shake {
  10%,
  90% {
    transform: translateX(-1px);
  }
  20%,
  80% {
    transform: translateX(2px);
  }
  30%,
  50%,
  70% {
    transform: translateX(-3px);
  }
  40%,
  60% {
    transform: translateX(3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .template-alerts--nudge {
    animation: none;
  }
}
.template-card__footer {
  flex-direction: column;
  align-items: stretch;
}
.template-card__footer-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}
.template-shell__opt-out {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-top: 14px;
  font-size: var(--takeover-fs-caption);
  line-height: 1.4;
  color: var(--neutral-400);
}
.template-shell__opt-out input[type='checkbox'] {
  margin: 0;
}
.template-shell__opt-out .brand-checkbox__text {
  line-height: 1.4;
}
.template-card__footer-actions .brand-ghost,
.template-card__footer-actions .brand-primary {
  height: 34px;
  padding-block: 0;
  padding-inline: 14px;
  font-size: var(--takeover-fs-caption);
}
.template-skip {
  border: 1px solid var(--brand-surface-border);
  color: var(--neutral-200);
}
.template-skip:hover:not([disabled]) {
  border-color: var(--brand-surface-border-hover);
  color: var(--neutral-100);
  background: var(--brand-surface-bg);
}
.template-install {
  min-width: 104px;
}
/* Reads as disabled but stays clickable so the click can shake the disk-error
 *  alert (mirrors the first-use consent gate). */
.template-install--blocked {
  cursor: not-allowed;
  opacity: 0.55;
}
.template-install--blocked:hover {
  background: var(--comfy-yellow);
  border-color: var(--comfy-yellow);
}

.config-card {
  width: 100%;
  /* Capped at shell height so the card doesn't overflow the viewport when Advanced expands; body scrolls instead. */
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--brand-surface-border);
  border-radius: 8px;
  background: var(--brand-surface-bg);
  backdrop-filter: blur(var(--brand-surface-blur));
  overflow: hidden;
  text-align: left;
}

.config-card__body {
  /* `flex: 1 1 auto` lets this body absorb leftover space and scroll internally once the card hits the shell cap, keeping the title centered. */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  /* Hide scrollbar to prevent layout shift when content overflows. */
  scrollbar-width: none;
}
.config-card__body::-webkit-scrollbar {
  display: none;
}

.workspace-authorization-status {
  width: 100%;
  color: var(--neutral-200);
  font-size: 13px;
  line-height: 1.4;
}

.config-card__footer {
  flex: 0 0 auto;
  padding: 14px 20px;
  border-top: 1px solid var(--brand-surface-border);
  background: var(--brand-surface-bg);
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}
.config-back {
  margin-right: auto;
}

.config-back-to-dashboard {
  position: absolute;
  left: clamp(1.25rem, 2vw, 2rem);
  bottom: clamp(1.25rem, 2vw, 2rem);
  z-index: 2;
}

.config-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.config-field--disabled {
  opacity: 0.5;
}
/* Keep the wrap hoverable for TooltipWrap; block interaction on controls only. */
.config-field--disabled input,
.config-field--disabled button,
.config-field--disabled .brand-input {
  pointer-events: none;
}
/* TooltipWrap defaults to `display: inline-flex`; promote to block-level
 * so the wrapped .config-field still fills the card width. */
.config-field-wrap {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.config-field-wrap > .config-field--disabled {
  cursor: not-allowed;
}
.config-label {
  font-size: 13px;
  color: var(--neutral-200);
}

.workspace-install-source {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--brand-surface-border);
  border-radius: 7px;
  background: var(--brand-surface-bg);
}
.workspace-install-source button {
  min-width: 0;
  padding: 7px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.workspace-install-source button:hover,
.workspace-install-source button.is-selected {
  background: var(--brand-surface-bg-hover);
  color: var(--neutral-100);
}
.workspace-install-source button:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.workspace-build-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.workspace-build-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.workspace-build-online {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--neutral-300);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.workspace-build-online:hover:not(:disabled) {
  color: var(--neutral-100);
  text-decoration: underline;
}
.workspace-build-online:disabled {
  cursor: wait;
  opacity: 0.55;
}
.workspace-build-online:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 2px;
}
.workspace-build-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.workspace-build-refresh:hover:not(:disabled) {
  color: var(--text);
}
.workspace-build-refresh:disabled {
  cursor: wait;
}
.workspace-build-refresh__icon--spinning {
  animation: workspace-build-spin 800ms linear infinite;
}
@keyframes workspace-build-spin {
  to {
    transform: rotate(360deg);
  }
}
.workspace-build-details {
  padding: 10px 12px;
  border: 1px solid var(--brand-surface-border);
  border-radius: 8px;
  background: var(--brand-surface-bg);
}
.workspace-build-description {
  margin: 0 0 8px;
  color: var(--neutral-100);
  font-size: 13px;
  line-height: 1.4;
}
.workspace-build-metadata {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 16px;
  margin: 0;
}
.workspace-build-metadata > div {
  min-width: 0;
}
.workspace-build-metadata dt {
  color: var(--text-muted);
  font-size: 11px;
}
.workspace-build-metadata dd {
  margin: 1px 0 0;
  overflow: hidden;
  color: var(--neutral-100);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Takes the row's flex 1 so the input and any sibling action button line up. */
.config-source-text {
  flex: 1 1 auto;
  min-width: 0;
}

.config-select {
  padding: 8px 12px;
  cursor: default;
}
/* Detected GPU is read-only; strip the hover affordance that would imply it's editable. */
.config-select--readonly:hover {
  border-color: var(--brand-surface-border);
  background: var(--brand-surface-bg);
}
.config-select--readonly .config-select__value {
  color: var(--text-muted);
}

.wizard-build-retry {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wizard-build-retry:hover:not(:disabled) {
  text-decoration: underline;
}
.config-select__value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--neutral-100);
  font-size: 14px;
}

.config-path-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.config-path-row > .config-path-input,
.config-path-row > button.brand-tertiary {
  height: 40px;
  padding-block: 0;
  display: flex;
  align-items: center;
}
.config-path-input {
  flex: 1 1 auto;
  min-width: 0;
  padding-inline: 12px;
}
/* Path text replaces the old readonly <input>; clicking it opens the selected
 *  install directory in the OS file manager. Inherits .open-folder-link; only
 *  the row-specific sizing/inheritance differ. */
.config-path-open {
  flex: 0 1 auto;
  color: inherit;
  font: inherit;
}
.config-path-open--static {
  cursor: default;
}
.config-path-open--static:hover {
  color: inherit;
  text-decoration: none;
}
.config-path-row > button.brand-tertiary {
  padding-inline: 14px;
  font-size: 13px;
}

.config-advanced {
  border-top: 1px solid var(--brand-surface-border);
  padding-top: var(--takeover-gap-md);
}
.config-advanced__summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  cursor: pointer;
  background: transparent;
  border: none;
  color: var(--neutral-200);
  font: inherit;
  font-size: var(--takeover-fs-body);
}
.config-advanced__summary:hover {
  color: var(--text);
  transition: color 120ms ease;
}
.config-advanced__summary:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 4px;
}
.config-advanced__chevron {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.config-advanced.is-open .config-advanced__chevron {
  transform: rotate(90deg);
}

.config-advanced__wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.config-advanced.is-open .config-advanced__wrap {
  grid-template-rows: 1fr;
}
.config-advanced__body {
  min-height: 0;
  overflow: hidden;
  padding-inline: 3px;
  margin-inline: -3px;
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity 220ms ease 60ms,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1) 40ms;
}
.config-advanced.is-open .config-advanced__body {
  margin-top: var(--takeover-gap-md);
  opacity: 1;
  transform: translateY(0);
}

/* Install-method chips: pill picker inside Advanced for swapping source without
 * leaving the brand chrome. Chips use the shared `.brand-pill` in main.css. */
.config-method-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.config-continue {
  min-width: 120px;
}
</style>
