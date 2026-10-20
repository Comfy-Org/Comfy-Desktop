<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronLeft,
  CircleAlert,
  Crown,
  HardDrive,
  LoaderCircle,
  RefreshCw
} from 'lucide-vue-next'
import { useModal } from '../composables/useModal'
import { useAuthStore } from '../stores/authStore'

import type {
  InstallBuildResult,
  Source,
  SourceField,
  FieldOption,
  HardwareValidation,
  ShowProgressOpts
} from '../types/ipc'
import { getVariantImage, stripVariantPrefix, sortedCardOptions } from '../lib/variants'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { PERSONAL_WORKSPACE_ID, workspaceContextId } from '../../../shared/workspaces'
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
  templateDownloadBytes,
  templateSizeBytes
} from '../lib/installHelpers'
import TakeoverPage from '../components/TakeoverPage.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'
import Button from '../design-system/components/Button.vue'
import Card from '../design-system/components/Card.vue'
import Checkbox from '../design-system/components/Checkbox.vue'
import Input from '../design-system/components/Input.vue'
import OptionCards from '../design-system/components/OptionCards.vue'
import type { OptionCard } from '../design-system/components/OptionCards.vue'
import PageHeader from '../design-system/components/PageHeader.vue'
import SegmentedControl from '../design-system/components/SegmentedControl.vue'
import Select from '../design-system/components/Select.vue'
import { fieldClass } from '../design-system/components/field.variants'
import Skeleton from '../design-system/components/Skeleton.vue'
import { cn } from '../design-system/cn'
import type { Build, BuildTarget } from '../devplatform/types'

/** The form's shared shapes: a labelled field, and its label, hint and error. */
const FIELD = 'flex flex-col gap-2'
const LABEL = 'text-ui font-medium text-base-foreground'
const HINT = 'text-ui text-subtle-foreground'
const ERROR = 'text-ui text-status-danger'

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
/** Resolve the local Personal scope to its server workspace for managed operations. */
const managedWorkspaceId = computed(() => {
  if (!authStore.isSignedIn || !workspaceId.value) return null
  if (workspaceId.value !== PERSONAL_WORKSPACE_ID) return workspaceId.value
  if (workspaceContextId(authStore.status) === PERSONAL_WORKSPACE_ID) {
    return authStore.status.workspaceId ?? null
  }
  return authStore.personalWorkspace?.id ?? null
})
const workspaceInstallMode = ref<'managed' | 'public'>('managed')
const managedBuildMode = computed(
  () => managedWorkspaceId.value !== null && workspaceInstallMode.value === 'managed'
)
const localInstallMode = computed(() => !managedBuildMode.value)

type InstallSourceTab =
  | { key: 'managed'; kind: 'managed' }
  | { key: string; kind: 'source'; source: Source }

const installSourceTabs = computed<InstallSourceTab[]>(() => {
  const sourceOrder = new Map([
    ['standalone', 0],
    ['remote', 1],
    ['portable', 2]
  ])
  const tabs: InstallSourceTab[] = [...sources.value]
    .sort(
      (a, b) =>
        (sourceOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (sourceOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )
    .map((source) => ({ key: `source-${source.id}`, kind: 'source', source }))

  const standaloneIndex = tabs.findIndex(
    (tab) => tab.kind === 'source' && tab.source.id === 'standalone'
  )
  tabs.splice(standaloneIndex + 1, 0, { key: 'managed', kind: 'managed' })

  return tabs
})

const workspaceBuilds = computed(() => {
  if (!managedWorkspaceId.value || authStore.status.workspaceId !== managedWorkspaceId.value)
    return []
  return authStore.builds.filter(
    (build) => build.state === 'installable' || build.state === 'update-available'
  )
})
const managedBuildCatalogLoaded = computed(
  () =>
    managedWorkspaceId.value !== null &&
    authStore.status.workspaceId === managedWorkspaceId.value &&
    authStore.buildsLoaded &&
    !authStore.buildsError
)
const workspaceBuildOptions = computed(() =>
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
  if (!localInstallMode.value) {
    // Managed builds report the whole-archive size; apply the same
    // download-to-installed factor as local variants.
    const sizeBytes = selectedBuild.value?.sizeBytes ?? 0
    return sizeBytes > 0 ? Math.ceil(sizeBytes * 2.25) : 0
  }
  let downloadBytes = 0
  for (const selected of Object.values(selections.value)) {
    const files = selected?.data?.downloadFiles as Array<{ size: number }> | undefined
    if (files) {
      downloadBytes += files.reduce((sum, f) => sum + f.size, 0)
    }
  }
  return downloadBytes > 0 ? Math.ceil(downloadBytes * 2.25) : 0
})

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
    source_id: managedBuildMode.value ? 'platform' : (currentSource.value?.id ?? null),
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
  return isTemplateDiskBlocked(diskSpace.value, templateDownloadBytes(selectedTemplate.value))
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
 *  (`pickerEnabled`) - shown to everyone on the standalone install path.
 *  The `localInstallMode` guard keeps the picker out of managed installs,
 *  which ignore templates entirely. */
const shouldShowPickerStep = computed(
  () =>
    localInstallMode.value &&
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

onMounted(() => {
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
  workspaceId.value = opts.workspaceId?.trim() || PERSONAL_WORKSPACE_ID
  workspaceInstallMode.value = 'public'
  selectedBuildId.value = ''
  selectedBuildTargetId.value = ''
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
  hardwareValidation = null
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
    await authStore.fetchStatus().catch(() => authStore.status)
    if (!authStore.isSignedIn) {
      workspaceId.value = PERSONAL_WORKSPACE_ID
    } else {
      workspaceInstallMode.value = 'managed'
    }
    if (
      workspaceId.value === PERSONAL_WORKSPACE_ID &&
      authStore.isSignedIn &&
      !managedWorkspaceId.value
    ) {
      await authStore.fetchWorkspaces()
    }
    // The dashboard prefetches this catalog when its workspace selection
    // changes. Use that result immediately: a catalog with no host-compatible
    // release defaults to Public Builds without flashing the empty Managed tab.
    if (managedBuildCatalogLoaded.value && workspaceBuilds.value.length === 0) {
      workspaceInstallMode.value = 'public'
    }
    await initializeInstallMode(gen, true)
    // Direct entry points may not have visited the dashboard. In that case the
    // managed initialization above performs the first fetch; apply the same
    // default once its result is known.
    if (
      gen === modeGeneration &&
      managedBuildMode.value &&
      managedBuildCatalogLoaded.value &&
      workspaceBuilds.value.length === 0
    ) {
      workspaceInstallMode.value = 'public'
      await initializeInstallMode(gen)
    }
  } finally {
    if (gen === modeGeneration) initializing.value = false
  }
}

async function initializeInstallMode(
  gen: number,
  refreshManagedBuilds = false,
  source?: Source
): Promise<void> {
  const installDir = await installDirPromise
  if (gen !== modeGeneration) return
  defaultInstPath.value = installDir ?? ''
  instPath.value = defaultInstPath.value

  if (managedBuildMode.value) {
    await Promise.all([initializeManagedBuilds(gen, refreshManagedBuilds), loadSources()])
  } else {
    await initializeLocalInstall(gen, source)
  }
}

async function initializeManagedBuilds(gen: number, refreshBuilds: boolean): Promise<void> {
  const targetWorkspaceId = managedWorkspaceId.value
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
    if (refreshBuilds || !authStore.buildsLoaded) await authStore.fetchBuilds()
    if (gen !== modeGeneration || !managedBuildMode.value) return
    selectedBuildId.value = workspaceBuilds.value[0]?.id ?? ''
    suggestManagedBuildName(selectedBuild.value)
  } catch {
    if (gen === modeGeneration && managedBuildMode.value) emit('close')
  }
}

async function initializeLocalInstall(gen: number, requestedSource?: Source): Promise<void> {
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

  const source = requestedSource ?? sources.value.find((source) => source.id === 'standalone')
  if (!source) return

  if (source.id !== 'standalone') {
    await selectSourceCard(source)
    return
  }

  hardwareValidation = await window.api.validateHardware()
  if (gen !== modeGeneration || !localInstallMode.value) return
  hardwareWarning.value = hardwareValidation.warning ?? ''
  if (hardwareValidation.supported) {
    await selectSourceCard(source)
  } else {
    detectedGpu.value = hardwareValidation.error || t('newInstall.noGpuDetected')
  }
}

async function selectManagedInstallMode(): Promise<void> {
  if (authorizingWorkspace.value || managedBuildMode.value) return
  let authenticatedNow = false
  if (!authStore.isSignedIn) {
    authorizingWorkspace.value = true
    try {
      const status = await authStore.signIn()
      if (!status.signedIn) return
      authenticatedNow = true
      if (workspaceId.value === PERSONAL_WORKSPACE_ID) await authStore.fetchWorkspaces()
    } catch {
      return
    } finally {
      authorizingWorkspace.value = false
    }
  }
  if (!managedWorkspaceId.value) {
    await modal.alert({
      title: t('chooser.errorTitle'),
      message: t('devPlatform.workspace.loadError')
    })
    return
  }
  workspaceInstallMode.value = 'managed'
  // Managed installs must not inherit source or template selections.
  resetSourceState(null)
  suggestedName.value = ''
  const gen = ++modeGeneration
  initializing.value = true
  try {
    await initializeInstallMode(gen, authenticatedNow)
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
  if (managedBuildMode.value) {
    workspaceInstallMode.value = 'public'
    resetSourceState(null)
    suggestedName.value = ''
    const gen = ++modeGeneration
    initializing.value = true
    try {
      await initializeInstallMode(gen, false, source)
    } finally {
      if (gen === modeGeneration) initializing.value = false
    }
    return
  }
  if (currentSource.value?.id === source.id) return

  if (source.id === 'standalone' && !hardwareValidation) {
    hardwareValidation = await window.api.validateHardware()
    hardwareWarning.value = hardwareValidation.warning ?? ''
  }
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

/** Drop all source-scoped wizard state (source, selections, loaded field
 *  options) and invalidate in-flight option loads. Runs when a source is
 *  picked and when the Managed/Public mode toggles, so no stale state (e.g.
 *  standalone template options) leaks across sources or modes. */
function resetSourceState(source: Source | null): void {
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
}

async function selectSource(source: Source): Promise<void> {
  resetSourceState(source)

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
  if (!managedWorkspaceId.value) return
  void window.api.comfybuilder.openBuildsPage(managedWorkspaceId.value).catch(() => {})
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

  // Soft-warn when the volume looks too small for the estimated install size.
  if (instPath.value && estimatedInstallSize.value > 0) {
    try {
      if (
        !(await checkDiskSpaceOrWarn({
          path: instPath.value,
          estimatedRequired: estimatedInstallSize.value,
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
      ...instData,
      ...(workspaceId.value ? { workspaceId: workspaceId.value } : {})
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
    if (
      !(await checkTemplateDiskOrBlock({
        path: instPath.value,
        estimatedModelBytes: templateDownloadBytes(selectedTemplate.value),
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
    ...instData,
    status: 'installing',
    ...(workspaceId.value ? { workspaceId: workspaceId.value } : {})
  })
  await handOffInstall(result, t('errors.cannotAdd'), templateHasModels.value)
}

function getSelectOptions(
  field: SourceField
): { value: string; label: string; description?: string }[] {
  const options = fieldOptions.value.get(field.id)
  if (!options) return []
  return options.map((opt) => ({
    value: opt.value,
    label: opt.recommended ? `${opt.label} (${t('newInstall.recommended')})` : opt.label,
    description: opt.description
  }))
}

/** The method row: Public builds, Managed builds (a workspace's), then the
 *  other sources. */
const sourceTabOptions = computed(() =>
  installSourceTabs.value.map((tab) =>
    tab.kind === 'managed'
      ? {
          value: 'managed',
          label: t('newInstall.managedBuilds'),
          testId: 'workspace-install-source-managed'
        }
      : {
          value: tab.source.id,
          label: tab.source.id === 'standalone' ? t('newInstall.publicBuilds') : tab.source.label,
          testId: `install-source-${tab.source.id}`
        }
  )
)
const sourceTab = computed(() =>
  managedBuildMode.value ? 'managed' : (currentSource.value?.id ?? '')
)

function selectSourceTab(value: string): void {
  if (value === 'managed') {
    void selectManagedInstallMode()
    return
  }
  const source = sources.value.find((candidate) => candidate.id === value)
  if (source) void selectSourceCard(source)
}

/** A card list's options: hardware logos, Recommended, and the API-credits
 *  mark on templates that call partner nodes. */
function toOptionCards(options: FieldOption[]): OptionCard[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
    image: getVariantImage(option) ?? undefined,
    tags: [
      ...(option.recommended ? [{ label: t('newInstall.recommended') }] : []),
      ...(isApiNodeTemplate(option)
        ? [{ label: t('standalone.templateApiBadge'), icon: Crown }]
        : [])
    ]
  }))
}

function selectCardValue(field: SourceField, fieldIndex: number, value: string | null): void {
  const option = fieldOptions.value.get(field.id)?.find((candidate) => candidate.value === value)
  if (option) selectCardOption(field, fieldIndex, option)
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
  <TakeoverPage
    :aria-label="
      step === 'configure' ? $t('newInstall.configureTitle') : $t('standalone.templatePickerTitle')
    "
  >
    <div v-if="step === 'configure'" class="config-shell">
      <PageHeader
        :title="$t('newInstall.configureTitle')"
        :description="$t('chooser.newInstallDesc')"
      />
      <Card class="flex flex-col gap-6 p-6">
        <p
          v-if="authorizingWorkspace"
          class="flex items-center gap-2 text-ui text-muted-foreground"
          role="status"
          data-testid="workspace-authorization-status"
        >
          <LoaderCircle :size="14" class="animate-spin motion-reduce:animate-none" />
          {{ $t('newInstall.waitingForWorkspaceAuthorization') }}
        </p>

        <div :class="FIELD">
          <label :class="LABEL" for="inst-name-standalone">{{ $t('common.name') }}</label>
          <Input
            id="inst-name-standalone"
            v-model="instName"
            autofocus
            :placeholder="suggestedName || $t('common.namePlaceholder')"
            :aria-invalid="!!nameError"
            :aria-describedby="nameError ? 'inst-name-error' : undefined"
            :class="nameError && 'border-status-danger'"
          />
          <p v-if="nameError" id="inst-name-error" :class="ERROR" role="alert">{{ nameError }}</p>
        </div>

        <div v-if="sources.length > 0" :class="FIELD">
          <span :class="LABEL">{{ $t('newInstall.chooseMethod') }}</span>
          <SegmentedControl
            :model-value="sourceTab"
            :options="sourceTabOptions"
            variant="contained"
            :disabled="authorizingWorkspace"
            :aria-label="$t('newInstall.chooseMethod')"
            class="config-method-row self-start"
            data-testid="install-source-tabs"
            @update:model-value="selectSourceTab"
          />
        </div>

        <div v-if="managedBuildMode" :class="FIELD" data-testid="workspace-build-field">
          <div class="flex items-center justify-between gap-3">
            <span :class="LABEL">{{ $t('newInstall.workspaceBuildLabel') }}</span>
            <div class="flex items-center gap-1">
              <Button variant="link" size="sm" :disabled="initializing" @click="openBuildsPage">{{
                $t('newInstall.viewBuildsOnline')
              }}</Button>
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('newInstall.refreshWorkspaceBuilds')"
                :disabled="authStore.loadingBuilds"
                @click="authStore.fetchBuilds()"
                ><RefreshCw
                  :size="14"
                  :class="authStore.loadingBuilds && 'animate-spin motion-reduce:animate-none'"
              /></Button>
            </div>
          </div>
          <Select
            v-model="selectedBuildId"
            :options="workspaceBuildOptions"
            :placeholder="
              authStore.loadingBuilds
                ? $t('newInstall.refreshingWorkspaceBuilds')
                : $t('newInstall.selectWorkspaceBuild')
            "
            :disabled="workspaceBuildOptions.length === 0"
            :aria-label="$t('newInstall.workspaceBuildLabel')"
          />
          <Button
            v-if="authStore.buildsError"
            variant="link"
            size="sm"
            class="self-start text-status-danger"
            :disabled="authStore.loadingBuilds"
            @click="authStore.fetchBuilds()"
            >{{ $t('devPlatform.build.loadError') }}</Button
          >
          <p
            v-else-if="
              !authorizingWorkspace &&
              !authStore.loadingBuilds &&
              workspaceBuildOptions.length === 0
            "
            :class="HINT"
          >
            {{ $t('newInstall.noCompatibleBuilds') }}
          </p>
        </div>

        <div
          v-if="managedBuildMode && selectedBuildTargetOptions.length > 0"
          :class="FIELD"
          data-testid="workspace-build-targets"
        >
          <span :class="LABEL">{{ $t('newInstall.buildTarget') }}</span>
          <OptionCards
            v-model="selectedBuildTargetId"
            :options="toOptionCards(selectedBuildTargetOptions)"
            :label="$t('newInstall.buildTarget')"
          />
        </div>

        <template v-if="!managedBuildMode">
          <p v-if="sourceError" :class="ERROR">{{ sourceError }}</p>
          <template v-if="currentSource">
            <div
              v-for="(field, fieldIndex) in currentSource.fields"
              v-show="!isHiddenWhenEmpty(field)"
              :key="field.id"
              :class="FIELD"
            >
              <!-- Cards and selects carry the field's name themselves (`label`, `aria-label`). -->
              <label :class="LABEL" :for="field.type === 'text' ? `sf-${field.id}` : undefined">{{
                field.label
              }}</label>

              <template v-if="field.type === 'text'">
                <div class="flex gap-2">
                  <Input
                    :id="`sf-${field.id}`"
                    :model-value="textFieldValues.get(field.id) ?? ''"
                    :placeholder="field.defaultValue || ''"
                    :aria-invalid="field.id === 'url' && !!urlFieldError"
                    :aria-describedby="
                      field.id === 'url' && urlFieldError ? `sf-${field.id}-error` : undefined
                    "
                    :class="
                      cn('flex-1', field.id === 'url' && urlFieldError && 'border-status-danger')
                    "
                    @update:model-value="textFieldValues.set(field.id, $event)"
                  />
                  <Button
                    v-if="field.action"
                    :id="`sf-${field.id}-action`"
                    @click="handleTextAction(field)"
                    >{{ field.action.label }}</Button
                  >
                </div>
                <p v-if="fieldErrors.get(field.id)" :class="ERROR">
                  {{ fieldErrors.get(field.id) }}
                </p>
                <p
                  v-else-if="field.id === 'url' && urlFieldError"
                  :id="`sf-${field.id}-error`"
                  :class="ERROR"
                  role="alert"
                >
                  {{ urlFieldError }}
                </p>
              </template>

              <template v-else-if="field.renderAs === 'cards'">
                <div v-if="fieldLoading.get(field.id)" class="flex flex-col gap-2" role="status">
                  <Skeleton v-for="i in 2" :key="i" class="h-15 rounded-control" />
                </div>
                <OptionCards
                  v-else-if="(fieldOptions.get(field.id)?.length ?? 0) > 0"
                  :model-value="selections[field.id]?.value ?? null"
                  :options="toOptionCards(sortedCardOptions(fieldOptions.get(field.id)!))"
                  :label="field.label"
                  :data-testid="`option-cards-${field.id}`"
                  @update:model-value="selectCardValue(field, fieldIndex, $event)"
                />
                <p v-else-if="fieldOptions.has(field.id)" :class="HINT">
                  {{
                    fieldErrors.get(field.id)
                      ? `Error: ${fieldErrors.get(field.id)}`
                      : $t('newInstall.noOptions')
                  }}
                </p>
              </template>

              <Select
                v-else
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
            </div>
          </template>
        </template>

        <div
          :class="cn(FIELD, currentSource?.skipInstall && 'opacity-50')"
          data-testid="install-location-field"
        >
          <span :class="LABEL">{{ $t('newInstall.installLocation') }}</span>
          <div class="flex gap-2">
            <div :class="cn(fieldClass, 'min-w-0 flex-1')">
              <HardDrive :size="14" class="shrink-0 text-subtle-foreground" aria-hidden="true" />
              <button
                v-if="!currentSource?.skipInstall && instPath"
                type="button"
                class="min-w-0 truncate text-left text-base-foreground outline-none hover:underline focus-visible:underline"
                :title="$t('actions.openDirectory', 'Open Directory')"
                :aria-label="`${$t('actions.openDirectory', 'Open Directory')}: ${instPath}`"
                @click="handleOpenInstPath"
              >
                {{ instPath }}
              </button>
              <span v-else class="min-w-0 truncate text-muted-foreground">{{ instPath }}</span>
            </div>
            <Button :disabled="!!currentSource?.skipInstall" @click="handleBrowse">{{
              $t('common.browse')
            }}</Button>
          </div>
          <p v-if="currentSource?.skipInstall" :class="HINT">
            {{ $t('newInstall.notAvailableRemote') }}
          </p>
          <!-- PathDiskInfo is shared with legacy screens: its line takes the hint's colour here. -->
          <div
            v-else
            :class="
              cn(
                HINT,
                'flex flex-wrap items-baseline gap-x-1.5 [&_.disk-space-info]:m-0 [&_.disk-space-info]:min-h-0 [&_.disk-space-info]:text-subtle-foreground'
              )
            "
          >
            <PathDiskInfo
              :path-issues="pathIssues"
              :disk-space-loading="diskSpaceLoading"
              :disk-space="diskSpace"
              :estimated-size="estimatedInstallSize"
            />
            <span aria-hidden="true">·</span>
            <span data-testid="detected-gpu-field">{{ detectedGpu }}</span>
          </div>
          <p
            v-if="hardwareWarning && !currentSource?.skipInstall"
            class="text-ui text-status-warning"
            role="alert"
            data-testid="wizard-hardware-warning"
          >
            {{ hardwareWarning }}
          </p>
        </div>

        <Button
          v-if="cameFromLocalBranch"
          variant="ghost"
          class="config-back self-start"
          data-testid="config-back-to-local-branch"
          @click="handleBackToLocalBranch"
          ><ChevronLeft :size="14" />{{ $t('common.back') }}</Button
        >
      </Card>
    </div>

    <!-- Dedicated starter-template picker step (after Configure, before install). -->
    <div v-else-if="step === 'template'" class="template-shell">
      <PageHeader
        :title="$t('standalone.templatePickerTitle')"
        :description="$t('standalone.templatePickerLead')"
      />
      <div
        v-if="hasTemplateAlerts"
        id="tps-alerts"
        :class="cn('mb-4', templateAlertNudge && 'animate-pop-in motion-reduce:animate-none')"
      >
        <p
          v-if="templateDiskError"
          class="flex items-center gap-2 text-ui text-status-danger"
          role="alert"
        >
          <CircleAlert :size="16" aria-hidden="true" />{{ templateDiskError }}
        </p>
      </div>
      <Card class="p-4">
        <TemplatePickerStep
          ref="pickerRef"
          :options="templateOptions"
          :none-value="NO_TEMPLATE_VALUE"
          :selected-value="selections.bundledTemplate?.value ?? null"
          :disk-space="diskSpace"
          :disk-space-loading="diskSpaceLoading"
          @select="selectTemplate"
        />
      </Card>
      <label
        v-if="hasLocalInstall"
        class="mt-4 flex cursor-pointer items-center gap-2.5 text-ui text-muted-foreground"
      >
        <Checkbox v-model="dontShowTemplatePicker" />
        {{ $t('standalone.templateDontShowAgain') }}
      </label>
    </div>

    <template #footer-left>
      <Button
        v-if="step === 'template'"
        variant="ghost"
        class="config-back-to-dashboard"
        @click="step = 'configure'"
        ><ChevronLeft :size="14" />{{ $t('common.back') }}</Button
      >
      <Button
        v-else-if="!hideBackToDashboard"
        variant="ghost"
        class="config-back-to-dashboard"
        @click="emit('close')"
        ><ChevronLeft :size="14" />{{ $t('common.backToDashboard') }}</Button
      >
    </template>
    <template #footer>
      <template v-if="step === 'template'">
        <Button
          size="lg"
          class="template-skip"
          :aria-label="$t('standalone.templateSkipAndInstallAria')"
          @click="handleTemplateSkip"
          >{{ $t('standalone.templateSkipAndInstall') }}</Button
        >
        <Button
          variant="primary"
          size="lg"
          :class="cn('template-install', templateInstallBlocked && 'opacity-40')"
          :aria-disabled="templateInstallBlocked"
          :aria-describedby="templateInstallBlocked ? 'tps-alerts' : undefined"
          @click="handleTemplateInstall"
          >{{ $t('standalone.templateInstall') }}</Button
        >
      </template>
      <Button
        v-else
        variant="primary"
        size="lg"
        class="config-continue"
        :disabled="!canContinue"
        @click="handleConfigureContinue"
        >{{ $t('common.continue') }}</Button
      >
    </template>
  </TakeoverPage>
</template>
