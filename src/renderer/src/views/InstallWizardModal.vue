<script setup lang="ts">
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
  toRaw,
  type Component
} from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Cpu,
  FolderArchive,
  Gpu,
  Globe,
  HardDrive,
  Package,
  RefreshCw,
  SlidersHorizontal,
  Users,
  X,
  Zap
} from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import { useModal } from '../composables/useModal'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'

import type {
  InstallBuildResult,
  Source,
  SourceField,
  FieldOption,
  HardwareValidation,
  ShowProgressOpts
} from '../types/ipc'
import { stripVariantPrefix, sortedCardOptions, getVariantImage } from '../lib/variants'
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
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import SetupMachineIllustration from '../components/SetupMachineIllustration.vue'
import SetupOptionCards, { type SetupOptionCard } from '../components/SetupOptionCards.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'
import InstallLocationRow from '../components/InstallLocationRow.vue'
import { BaseSelect, type BaseSelectOption } from '../components/ui'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import { formatBytes, formatFreeSpace } from '../lib/formatting'
import type { Build, BuildTarget } from '../devplatform/types'

const emit = defineEmits<{
  close: []
  'show-progress': [opts: ShowProgressOpts]
  'navigate-list': []
  'back-to-local-branch': []
  'show-build-import': [flow: 'track' | 'load-snapshot']
}>()

const spinnerClass =
  'flex items-center gap-2.5 before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--action)] before:content-[""] before:[animation-duration:600ms]'

const props = withDefaults(
  defineProps<{
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
const suggestedName = ref('')
const instPath = ref('')
const defaultInstPath = ref('')
const detectedGpu = ref('')
const gpuName = ref('')
const machineUnsupported = ref(false)
const unsupportedReason = ref('')
const view = ref<'summary' | 'change'>('summary')
const platform = window.api?.platform ?? 'darwin'
const hardwareWarning = ref('')
const saveDisabled = ref(true)
const sourcesLoading = ref(false)
const initializing = ref(false)
const authorizingWorkspace = ref(false)
const sourceError = ref('')
const workspaceId = ref<string | null>(null)
const selectedBuildId = ref('')
const selectedBuildTargetId = ref('')
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

const fieldOptions = ref(new Map<string, FieldOption[]>())
const fieldLoading = ref(new Map<string, boolean>())
const fieldErrors = ref(new Map<string, string>())
const textFieldValues = ref(new Map<string, string>())

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

const entrypoint = ref('unknown')
const resolved = ref(false)

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

const selectedTemplate = computed<FieldOption | null>(() => {
  const sel = selections.value.bundledTemplate
  return sel && sel.value !== NO_TEMPLATE_VALUE ? sel : null
})

const templateHasModels = computed(() => {
  const size = selectedTemplate.value?.data?.sizeBytes as number | undefined
  return typeof size === 'number' && size > 0
})

const templateIsApiNode = computed(() => isApiNodeTemplate(selectedTemplate.value))

const templateInstallBlocked = computed(() => {
  if (diskSpaceLoading.value) return false
  return isTemplateDiskBlocked(diskSpace.value, templateDownloadBytes(selectedTemplate.value))
})

const pickerRef = ref<InstanceType<typeof TemplatePickerStep> | null>(null)

const templateDiskError = computed(() => pickerRef.value?.shownDiskError ?? null)
const hasTemplateAlerts = computed(() => !!templateDiskError.value)

const templateAlertNudge = ref(false)
let templateNudgeTimer: ReturnType<typeof setTimeout> | undefined
function nudgeTemplateAlert(): void {
  templateAlertNudge.value = true
  clearTimeout(templateNudgeTimer)
  templateNudgeTimer = setTimeout(() => {
    templateAlertNudge.value = false
  }, 600)
}

const step = ref<'configure' | 'template'>('configure')
const dontShowTemplatePicker = ref(false)
const pickerEnabled = ref(true)
const hasLocalInstall = ref(false)

const templateOptions = computed<FieldOption[]>(
  () => fieldOptions.value.get('bundledTemplate') ?? []
)

const diskTooSmallForAnyTemplate = computed(() => {
  if (diskSpaceLoading.value || !diskSpace.value) return false
  if (templateOptions.value.some(isApiNodeTemplate)) return false
  const cheapest = minTemplateModelBytes(templateOptions.value.map(templateSizeBytes))
  return isTemplateDiskBlocked(diskSpace.value, cheapest)
})

const asksForTemplate = computed(() => props.hideBackToDashboard)
const offersBuildImport = computed(() => !props.hideBackToDashboard)

const shouldShowPickerStep = computed(
  () =>
    asksForTemplate.value &&
    localInstallMode.value &&
    currentSource.value?.id === 'standalone' &&
    pickerEnabled.value &&
    templateOptions.value.length > 0 &&
    !diskTooSmallForAnyTemplate.value
)

function selectTemplate(option: FieldOption): void {
  const prev = selections.value.bundledTemplate?.value
  selections.value.bundledTemplate = option
  if (option.value !== NO_TEMPLATE_VALUE && option.value !== prev) {
    const sizeBytes = (option.data?.sizeBytes as number | undefined) ?? 0
    emitTelemetryAction('comfy.desktop.template.selected', {
      template_id: option.value,
      size_bucket: toSizeBucket(sizeBytes),
      is_api_node: isApiNodeTemplate(option)
    })
  }
}

async function handleConfigureContinue(): Promise<void> {
  if (shouldShowPickerStep.value) {
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
    } catch {}
  }
}

watch(instPath, (newPath) => {
  diskSpace.value = null
  pathIssues.value = []
  fetchDiskSpace(newPath)
})

let loadGeneration = 0
let modeGeneration = 0
let changeSetupSession = 0

const nameError = computed(() =>
  instName.value.length > 0 && instName.value.trim().length === 0
    ? t('newInstall.nameWhitespace')
    : ''
)

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

const urlFieldError = computed(() => {
  const source = currentSource.value
  if (!source) return ''
  const urlField = source.fields.find((f) => f.id === 'url' && f.type === 'text')
  if (!urlField) return ''
  const value = textFieldValues.value.get('url') ?? ''
  return isValidConnectionUrl(value) ? '' : t('newInstall.urlInvalid')
})

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

function rawSelections(): Record<string, FieldOption> {
  const raw = toRaw(selections.value)
  const result: Record<string, FieldOption> = {}
  for (const [key, val] of Object.entries(raw)) {
    result[key] = JSON.parse(JSON.stringify(toRaw(val))) as FieldOption
  }
  return result
}

let gpuDetectionDone = false
let installDirPromise: Promise<string> | null = null
let sourcesPromise: Promise<Source[]> | null = null

onMounted(() => {
  window.api
    .detectGPU()
    .then((gpu) => {
      if (gpu) {
        gpuName.value = gpu.label
        detectedGpu.value = t('newInstall.detectedGpu', { label: gpu.label })
      } else {
        detectedGpu.value = t('newInstall.noGpuDetected')
      }
    })
    .catch(() => {
      detectedGpu.value = t('newInstall.noGpuDetected')
    })
    .finally(() => {
      gpuDetectionDone = true
    })

  installDirPromise = window.api.getDefaultInstallDir().catch(() => '')
  sourcesPromise = window.api.getSources()
})

onBeforeUnmount(() => {
  if (!resolved.value && !currentSource.value?.skipInstall) {
    emitTelemetryAction('comfy.desktop.install.not_started', {
      ...installHandoffProps(),
      reason: 'wizard_cancelled'
    })
  }
  clearTimeout(templateNudgeTimer)
})

function handleBackToLocalBranch(): void {
  resolved.value = true
  emitTelemetryAction('comfy.desktop.install.not_started', {
    ...installHandoffProps(),
    reason: 'back_to_local_branch'
  })
  emit('back-to-local-branch')
}

interface OpenOpts {
  cameFromLocalBranch?: boolean
  entrypoint?: string
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

  if (!gpuName.value && !gpuDetectionDone) detectedGpu.value = t('newInstall.detectingGpu')
  machineUnsupported.value = false
  unsupportedReason.value = ''
  view.value = 'summary'
  changeSetupDraft = null
  hardwareValidation = null
  hardwareWarning.value = ''
  resetDiskSpace()
  sourceError.value = ''
  authorizingWorkspace.value = false
  initializing.value = true
  step.value = 'configure'
  dontShowTemplatePicker.value = false
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
    if (managedBuildCatalogLoaded.value && workspaceBuilds.value.length === 0) {
      workspaceInstallMode.value = 'public'
    }
    await initializeInstallMode(gen, true)
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
      useDashboardScopeStore().takeChosenSelection()
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

async function refreshManagedBuilds(): Promise<void> {
  if (authStore.status.workspaceId === managedWorkspaceId.value) await authStore.fetchBuilds()
  else await initializeManagedBuilds(modeGeneration, true)
}

async function initializeLocalInstall(gen: number, requestedSource?: Source): Promise<void> {
  void window.api
    .getUniqueName(DEFAULT_INSTALL_NAME)
    .then((name) => {
      if (gen === modeGeneration && localInstallMode.value) suggestedName.value = name
    })
    .catch(() => {})

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
    machineUnsupported.value = true
    unsupportedReason.value = hardwareValidation.error || t('newInstall.noGpuDetected')
  }
}

async function selectManagedInstallMode(): Promise<void> {
  if (authorizingWorkspace.value || managedBuildMode.value) return
  let authenticatedNow = false
  if (!authStore.isSignedIn) {
    const session = changeSetupSession
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
    if (session !== changeSetupSession) return
  }
  if (!managedWorkspaceId.value) {
    await modal.alert({
      title: t('chooser.errorTitle'),
      message: t('devPlatform.workspace.loadError')
    })
    return
  }
  workspaceInstallMode.value = 'managed'
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

function resetSourceState(source: Source | null): void {
  loadGeneration++
  currentSource.value = source
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

  const firstLoadable = source.fields.findIndex((f) => f.type !== 'text')
  if (firstLoadable >= 0) {
    await loadFieldOptions(firstLoadable)
  }

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

  for (let i = fieldIndex + 1; i < source.fields.length; i++) {
    const df = source.fields[i]
    if (!df || df.type === 'text') continue
    fieldOptions.value.delete(df.id)
    fieldLoading.value.set(df.id, false)
    delete selections.value[df.id]
  }

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

    if (gen !== loadGeneration) return

    fieldLoading.value.set(field.id, false)
    fieldOptions.value.set(field.id, options)

    if (field.id === 'bundledTemplate' && !asksForTemplate.value) {
      const none = options.find((opt) => opt.value === NO_TEMPLATE_VALUE)
      if (none) selections.value[field.id] = none
      else delete selections.value[field.id]
    } else if (options.length > 0) {
      let defaultIndex =
        field.id === 'bundledTemplate' ? 0 : options.findIndex((opt) => opt.recommended)
      if (defaultIndex < 0) defaultIndex = 0
      const defaultOption = options[defaultIndex]
      if (defaultOption) selections.value[field.id] = defaultOption
    } else {
      delete selections.value[field.id]
    }

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
    } catch {}
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

  if (source.id === 'standalone') {
    const variantId = selections.value.variant?.data?.variantId as string | undefined
    if (variantId && stripVariantPrefix(variantId).startsWith('nvidia')) {
      if (!(await checkNvidiaDriverOrWarn('wizard', 'save', modal.confirm, t))) {
        return
      }
    }
  }

  for (const f of source.fields) {
    if (f.type === 'text') {
      const value = textFieldValues.value.get(f.id) ?? ''
      selections.value[f.id] = { value, label: value }
    }
  }

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
    } catch {}
  }

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

function getSelectOptions(field: SourceField): BaseSelectOption[] {
  const options = fieldOptions.value.get(field.id)
  if (!options) return []
  return options.map((opt) => ({
    value: opt.value,
    label: opt.label,
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

const HARDWARE_FIELD_ID = 'variant'
const locationBeforeHardware = computed(
  () =>
    showLocation.value &&
    !managedBuildMode.value &&
    !!currentSource.value?.fields.some((field) => field.id === HARDWARE_FIELD_ID)
)

function hardwareIcon(option: FieldOption): Component {
  const variant = stripVariantPrefix((option.data?.variantId as string) ?? option.value)
  return variant === 'cpu' || variant.startsWith('cpu-') ? Cpu : Gpu
}

const releaseChoices = computed(() => {
  const options = fieldOptions.value.get('release')
  if (!options || options.length !== 2) return null
  return options.map((option) => ({ value: option.value, label: option.label }))
})

function isSegmentedRelease(field: SourceField): boolean {
  return field.id === 'release' && releaseChoices.value !== null
}

const versionFieldIndex = computed(
  () => currentSource.value?.fields.findIndex((field) => field.id === 'comfyVersion') ?? -1
)
const inlineVersionField = computed(() => {
  if (!releaseChoices.value) return null
  const field = currentSource.value?.fields[versionFieldIndex.value]
  return field && !isHiddenWhenEmpty(field) ? field : null
})

function isInlinedField(field: SourceField): boolean {
  return field.id === 'comfyVersion' && releaseChoices.value !== null
}

function selectReleaseChoice(field: SourceField, fieldIndex: number, value: string): void {
  if (selections.value[field.id]?.value === value) return
  onSelectFieldChange(field, fieldIndex, value)
}

const diskFreeLabel = computed(() =>
  !diskSpaceLoading.value && diskSpace.value
    ? t('diskSpace.free', { size: formatFreeSpace(diskSpace.value.free) })
    : ''
)
const diskShortLabel = computed(() => {
  const required = estimatedInstallSize.value
  if (diskSpaceLoading.value || !diskSpace.value || required <= 0) return ''
  if (diskSpace.value.free >= required) return ''
  return t('newInstall.requiredSpace', { size: formatBytes(required) })
})

interface ChangeSetupDraft {
  sourceKey: string | null
  selections: Record<string, FieldOption>
  fieldOptions: Map<string, FieldOption[]>
  fieldLoading: Map<string, boolean>
  fieldErrors: Map<string, string>
  textFieldValues: Map<string, string>
  saveDisabled: boolean
  sourceError: string
  instPath: string
  selectedBuildId: string
  selectedBuildTargetId: string
}

let changeSetupDraft: ChangeSetupDraft | null = null

function openChangeSetup(): void {
  changeSetupDraft = {
    sourceKey: selectedSourceCard.value,
    selections: { ...selections.value },
    fieldOptions: new Map(fieldOptions.value),
    fieldLoading: new Map(fieldLoading.value),
    fieldErrors: new Map(fieldErrors.value),
    textFieldValues: new Map(textFieldValues.value),
    saveDisabled: saveDisabled.value,
    sourceError: sourceError.value,
    instPath: instPath.value,
    selectedBuildId: selectedBuildId.value,
    selectedBuildTargetId: selectedBuildTargetId.value
  }
  view.value = 'change'
}

function saveChangeSetup(): void {
  changeSetupDraft = null
  view.value = 'summary'
}

async function restoreSourceCard(key: string): Promise<void> {
  const tab = installSourceTabs.value.find((candidate) => candidate.key === key)
  if (!tab) return
  if (tab.kind === 'managed') await selectManagedInstallMode()
  else if (managedBuildMode.value) await selectSourceCard(tab.source)
  else await selectSource(tab.source)
}

async function discardChangeSetup(): Promise<void> {
  changeSetupSession++
  const draft = changeSetupDraft
  changeSetupDraft = null
  view.value = 'summary'
  if (!draft) return
  if (draft.sourceKey !== selectedSourceCard.value) {
    if (draft.sourceKey) await restoreSourceCard(draft.sourceKey)
    else {
      modeGeneration++
      workspaceInstallMode.value = 'public'
      resetSourceState(null)
    }
  }
  if (draft.sourceKey !== selectedSourceCard.value) return
  instPath.value = draft.instPath
  if (managedBuildMode.value) {
    selectedBuildId.value = draft.selectedBuildId
    await nextTick()
    selectedBuildTargetId.value = draft.selectedBuildTargetId
    return
  }
  loadGeneration++
  selections.value = draft.selections
  fieldOptions.value = draft.fieldOptions
  fieldLoading.value = draft.fieldLoading
  fieldErrors.value = draft.fieldErrors
  textFieldValues.value = draft.textFieldValues
  saveDisabled.value = draft.saveDisabled
  sourceError.value = draft.sourceError
  const interruptedLoad =
    currentSource.value?.fields.findIndex((field) => draft.fieldLoading.get(field.id)) ?? -1
  if (interruptedLoad >= 0) await loadFieldOptions(interruptedLoad)
}

function isHiddenWhenEmpty(field: SourceField): boolean {
  if (field.id === 'bundledTemplate' && (!asksForTemplate.value || shouldShowPickerStep.value))
    return true
  if (field.type === 'text' || field.renderAs === 'cards') return false
  const options = fieldOptions.value.get(field.id)
  if (options === undefined) return false
  return options.length === 0 && !fieldLoading.value.get(field.id)
}

const machineBlocked = computed(
  () =>
    machineUnsupported.value &&
    !managedBuildMode.value &&
    (!currentSource.value || currentSource.value.id === 'standalone')
)
const machineTitle = computed(() =>
  machineBlocked.value ? unsupportedReason.value : gpuName.value || detectedGpu.value
)
const machineDetected = computed(() => !machineBlocked.value && !!gpuName.value)
const blockingFieldError = computed(
  () => urlFieldError.value || fieldErrors.value.values().next().value || ''
)

const remoteSource = computed(() => sources.value.find((source) => source.id === 'remote') ?? null)
const remoteSelected = computed(
  () => !managedBuildMode.value && !!remoteSource.value && currentSource.value?.id === 'remote'
)

const SOURCE_ICONS: Record<string, Component> = {
  standalone: Package,
  portable: FolderArchive
}

const sourceCards = computed<SetupOptionCard[]>(() =>
  installSourceTabs.value
    .filter((tab) => !(tab.kind === 'source' && tab.source.id === 'remote'))
    .map((tab) =>
      tab.kind === 'managed'
        ? {
            value: tab.key,
            label: t('newInstall.managedBuilds'),
            description: t('newInstall.managedBuildsMeta'),
            icon: Users,
            testId: 'workspace-install-source-managed',
            disabled: authorizingWorkspace.value
          }
        : {
            value: tab.key,
            label: tab.source.id === 'standalone' ? t('newInstall.publicBuilds') : tab.source.label,
            description:
              tab.source.id === 'standalone'
                ? t('newInstall.publicBuildsMeta')
                : tab.source.description,
            icon: SOURCE_ICONS[tab.source.id] ?? Package,
            testId: `install-source-${tab.source.id}`,
            disabled: authorizingWorkspace.value
          }
    )
)

const selectedSourceCard = computed(() => {
  if (managedBuildMode.value) return 'managed'
  return currentSource.value ? `source-${currentSource.value.id}` : null
})

async function selectSourceCardByKey(key: string): Promise<void> {
  const tab = installSourceTabs.value.find((candidate) => candidate.key === key)
  if (!tab) return
  if (tab.kind === 'managed') await selectManagedInstallMode()
  else await selectSourceCard(tab.source)
}

async function selectRemoteSource(): Promise<void> {
  if (remoteSource.value) await selectSourceCard(remoteSource.value)
}

async function selectStandaloneSource(): Promise<void> {
  const standalone = sources.value.find((source) => source.id === 'standalone')
  if (standalone) await selectSourceCard(standalone)
}

function backToConfigure(): void {
  step.value = 'configure'
  view.value = 'summary'
}

function toOptionCards(options: FieldOption[]): SetupOptionCard[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
    recommended: option.recommended,
    credits: isApiNodeTemplate(option),
    image: getVariantImage(option)
  }))
}

function toHardwareCards(options: FieldOption[]): SetupOptionCard[] {
  return toOptionCards(options).map((card, index) => ({
    ...card,
    image: null,
    icon: hardwareIcon(options[index]!)
  }))
}

function selectCardOptionByValue(field: SourceField, fieldIndex: number, value: string): void {
  const option = fieldOptions.value.get(field.id)?.find((candidate) => candidate.value === value)
  if (option) selectCardOption(field, fieldIndex, option)
}

const buildTargetCards = computed(() => toHardwareCards(selectedBuildTargetOptions.value))

const FIELD_ICONS: Record<string, Component> = {
  variant: Zap,
  release: Package,
  version: Package,
  asset: Package,
  url: Globe
}

interface SummaryRow {
  key: string
  icon: Component
  label: string
  value: string
  meta?: string
}

function fieldSummaryValue(field: SourceField): string {
  if (field.type === 'text') return textFieldValues.value.get(field.id) ?? ''
  if (fieldLoading.value.get(field.id)) return t('newInstall.loading')
  return selections.value[field.id]?.label ?? getSelectPlaceholder(field)
}

const summaryRows = computed<SummaryRow[]>(() => {
  if (managedBuildMode.value) {
    const rows: SummaryRow[] = [
      {
        key: 'managed-build',
        icon: Package,
        label: t('newInstall.workspaceBuildLabel'),
        value: selectedBuild.value?.name ?? t('newInstall.selectWorkspaceBuild'),
        meta: selectedBuild.value ? buildOptionDescription(selectedBuild.value) : undefined
      }
    ]
    const target = selectedBuildTargetOptions.value.find(
      (option) => option.value === selectedBuildTargetId.value
    )
    if (target) {
      rows.push({
        key: 'managed-target',
        icon: Zap,
        label: t('newInstall.buildTarget'),
        value: target.label,
        meta: target.description
      })
    }
    return rows
  }
  const source = currentSource.value
  if (!source) return []
  return source.fields
    .filter((field) => !isHiddenWhenEmpty(field))
    .map((field) => ({
      key: `field-${field.id}`,
      icon: FIELD_ICONS[field.id] ?? SlidersHorizontal,
      label: field.label,
      value: fieldSummaryValue(field),
      meta: field.type === 'text' ? undefined : selections.value[field.id]?.description
    }))
})

const showLocation = computed(() => !currentSource.value?.skipInstall)

const primaryLabel = computed(() => {
  if (shouldShowPickerStep.value) return t('common.continue')
  if (!managedBuildMode.value && currentSource.value?.skipInstall) return t('newInstall.connect')
  return t('newInstall.install')
})

const useTakeoverHost = computed(() => props.hideBackToDashboard)
const ariaLabel = computed(() =>
  t(step.value === 'template' ? 'standalone.templatePickerTitle' : 'newInstall.newBuildTitle')
)

defineExpose({ open })
</script>

<template>
  <component
    :is="useTakeoverHost ? BrandTakeoverLayout : DesktopDialogSurface"
    v-bind="
      useTakeoverHost
        ? { scrollContent: true, ariaLabel }
        : {
            open: true,
            ariaLabel,
            dismissOnEscape: false,
            dismissOnOutside: false,
            overlayClass:
              'install-wizard-overlay fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-6 animate-fade-in motion-reduce:animate-none',
            contentClass: 'install-wizard-surface relative max-w-full outline-none'
          }
    "
  >
    <div
      class="install-wizard-frame flex w-full items-center justify-center"
      :class="useTakeoverHost && 'min-h-full py-[clamp(1.5rem,4vh,3rem)]'"
    >
      <section
        class="install-wizard-panel relative flex max-h-[calc(100vh-48px)] max-w-full flex-col rounded-[16px] bg-neutral-900 text-left [box-shadow:0_24px_64px_rgb(0_0_0/0.5),inset_0_0_0_1px_rgb(255_255_255/0.06)] animate-pop-in motion-reduce:animate-none"
        :class="
          step === 'template'
            ? 'w-[min(960px,calc(100vw-48px))]'
            : 'w-[min(760px,calc(100vw-48px))]'
        "
        data-testid="new-build-modal"
      >
        <Button
          v-if="step === 'configure' && !hideBackToDashboard"
          size="icon"
          variant="muted-textonly"
          type="button"
          class="config-back-to-dashboard absolute top-0 -right-12 z-2 size-9 rounded-full bg-white/10 text-white hover:bg-white/18 hover:text-white max-[860px]:top-3 max-[860px]:right-3"
          :aria-label="$t('common.close')"
          :title="$t('common.backToDashboard')"
          @click="emit('close')"
        >
          <X :size="18" aria-hidden="true" />
        </Button>

        <div
          class="install-wizard-body min-h-0 flex-auto overflow-y-auto px-8 pt-7 pb-6 [scrollbar-width:thin]"
        >
          <template v-if="step === 'configure'">
            <h2
              class="wizard-title m-0 text-[18px] leading-7 font-semibold tracking-[-0.01em] text-neutral-100"
            >
              {{
                $t(view === 'change' ? 'newInstall.changeSetupTitle' : 'newInstall.newBuildTitle')
              }}
            </h2>
            <p class="wizard-lead m-0 mt-1 text-[13px] leading-5 text-text-muted">
              {{ $t(view === 'change' ? 'newInstall.changeSetupLead' : 'chooser.newInstallDesc') }}
            </p>

            <div
              v-if="authorizingWorkspace"
              class="workspace-authorization-status mt-4 w-full text-[13px] leading-[1.4] text-neutral-200"
              :class="spinnerClass"
              role="status"
              data-testid="workspace-authorization-status"
            >
              {{ $t('newInstall.waitingForWorkspaceAuthorization') }}
            </div>
            <div
              v-if="sourceError"
              class="config-error mt-4 text-[13px] leading-[1.4] text-[var(--danger)]"
              role="alert"
            >
              {{ sourceError }}
            </div>

            <div v-if="view === 'summary'" class="config-summary" data-testid="config-summary">
              <div
                class="config-name-card mt-4 grid grid-cols-[132px_minmax(0,1fr)] items-center gap-x-4 rounded-[12px] bg-white/6 px-4 py-3 [box-shadow:inset_0_0_0_1px_rgb(255_255_255/0.07)]"
              >
                <label
                  class="config-label pl-6 text-[13px] font-medium text-text-muted"
                  for="inst-name-standalone"
                  >{{ $t('common.name') }}</label
                >
                <InputGroup class="config-input" :class="{ 'config-input--invalid': nameError }">
                  <InputGroupInput
                    id="inst-name-standalone"
                    :data-initial-focus="hideBackToDashboard || undefined"
                    :model-value="instName"
                    type="text"
                    :placeholder="suggestedName || $t('common.namePlaceholder')"
                    :aria-invalid="!!nameError"
                    :aria-describedby="nameError ? 'inst-name-error' : undefined"
                    @input="instName = ($event.target as HTMLInputElement).value"
                  />
                </InputGroup>
                <div
                  v-if="nameError"
                  id="inst-name-error"
                  class="config-field-error col-start-2 mt-1.5 text-[13px] text-[var(--danger)]"
                  role="alert"
                >
                  {{ nameError }}
                </div>
              </div>

              <div
                class="config-machine relative mt-3 flex items-center gap-7 overflow-hidden rounded-[18px] px-7 py-6 [background:radial-gradient(ellipse_70%_120%_at_12%_0%,rgb(255_255_255/0.09),transparent_70%),rgb(255_255_255/0.04)]"
                :class="machineBlocked && 'config-machine--unsupported'"
              >
                <SetupMachineIllustration
                  class="h-[88px] w-[136px] flex-none max-[640px]:hidden"
                  :os="platform"
                  :bad="machineBlocked"
                />
                <span class="grid min-w-0">
                  <span
                    v-if="machineDetected"
                    class="config-machine-kicker mb-1 inline-flex items-center gap-1.5 text-[12px] leading-4 text-text-muted"
                    ><Check :size="11" :stroke-width="3" aria-hidden="true" />{{
                      $t('newInstall.detected')
                    }}</span
                  >
                  <span
                    class="config-gpu-value text-[22px] leading-7 font-semibold tracking-[-0.01em]"
                    :class="
                      machineBlocked
                        ? 'text-[16px] leading-6 break-words text-[var(--danger)]'
                        : 'truncate text-neutral-100'
                    "
                    data-testid="detected-gpu-field"
                    >{{ machineTitle }}</span
                  >
                </span>
                <Button
                  size="md"
                  variant="secondary"
                  type="button"
                  class="config-change ml-auto flex-none"
                  data-testid="config-change-setup"
                  @click="openChangeSetup"
                >
                  {{ $t('newInstall.change') }}
                </Button>
              </div>
              <div
                v-if="hardwareWarning && !currentSource?.skipInstall"
                class="config-hardware-warning mt-2 px-1 text-[12px] leading-[1.4] text-[var(--warning)]"
                role="alert"
                data-testid="wizard-hardware-warning"
              >
                {{ hardwareWarning }}
              </div>
              <div
                v-if="blockingFieldError"
                class="config-summary-field-error mt-2 px-1 text-[12px] leading-[1.4] text-[var(--danger)]"
                role="alert"
                data-testid="config-summary-field-error"
              >
                {{ blockingFieldError }}
              </div>

              <dl
                class="config-summary-list m-0 mt-3 flex flex-col rounded-[14px] bg-white/5 p-1.5"
                :aria-label="$t('newInstall.installSummary')"
              >
                <div
                  v-for="row in summaryRows"
                  :key="row.key"
                  class="config-summary-row grid min-h-12 grid-cols-[132px_minmax(0,1fr)] items-center gap-4 rounded-[10px] px-3.5 py-2"
                >
                  <dt class="flex items-center gap-2.5 text-[13px] text-text-muted">
                    <component :is="row.icon" :size="15" aria-hidden="true" />{{ row.label }}
                  </dt>
                  <dd class="m-0 grid min-w-0">
                    <span class="truncate text-[13px] leading-5 text-neutral-100">{{
                      row.value
                    }}</span>
                    <span v-if="row.meta" class="truncate text-[12px] leading-4 text-text-muted">{{
                      row.meta
                    }}</span>
                  </dd>
                </div>
                <div
                  v-if="showLocation"
                  class="config-summary-row config-summary-location grid min-h-12 grid-cols-[132px_minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3.5 py-2"
                >
                  <dt class="flex items-center gap-2.5 text-[13px] text-text-muted">
                    <HardDrive :size="15" aria-hidden="true" />{{ $t('common.location') }}
                  </dt>
                  <dd
                    class="m-0 grid min-w-0 [&_.path-disk-info]:mt-0 [&_.path-disk-info]:text-[12px]"
                  >
                    <span class="truncate text-[13px] leading-5 text-neutral-100">{{
                      instPath
                    }}</span>
                    <PathDiskInfo
                      :path-issues="pathIssues"
                      :disk-space-loading="diskSpaceLoading"
                      :disk-space="diskSpace"
                      :estimated-size="estimatedInstallSize"
                    />
                  </dd>
                  <Button
                    size="sm"
                    variant="muted-textonly"
                    type="button"
                    class="config-summary-browse"
                    @click="handleBrowse"
                  >
                    {{ $t('common.browse') }}
                  </Button>
                </div>
                <div
                  v-if="initializing && summaryRows.length === 0"
                  class="config-loading px-3.5 py-3 text-[13px] text-text-muted"
                  :class="spinnerClass"
                >
                  {{ $t('newInstall.loading') }}
                </div>
              </dl>
            </div>

            <div
              v-else
              class="config-change-form mt-4 flex flex-col"
              data-testid="config-change-form"
            >
              <div
                v-if="hardwareWarning && !currentSource?.skipInstall"
                class="config-hardware-warning px-1 pb-2 text-[12px] leading-[1.4] text-[var(--warning)]"
                role="alert"
                data-testid="wizard-hardware-warning"
              >
                {{ hardwareWarning }}
              </div>
              <div
                v-if="sources.length > 0"
                class="config-form-row grid grid-cols-[148px_minmax(0,1fr)] items-start gap-4 py-3"
              >
                <span
                  id="config-source-label"
                  class="config-label pt-3.5 text-[13px] font-medium text-text-muted"
                  >{{ $t('newInstall.getComfyFrom') }}</span
                >
                <SetupOptionCards
                  class="config-method-row"
                  data-testid="install-source-tabs"
                  layout="grid"
                  :aria-label="$t('newInstall.chooseMethod')"
                  :options="sourceCards"
                  :selected-value="selectedSourceCard"
                  @select="selectSourceCardByKey"
                />
              </div>

              <template v-if="managedBuildMode">
                <div
                  class="config-form-row config-field grid grid-cols-[148px_minmax(0,1fr)] items-start gap-4 py-3"
                  data-testid="workspace-build-field"
                >
                  <label class="config-label pt-2.5 text-[13px] font-medium text-text-muted">{{
                    $t('newInstall.workspaceBuildLabel')
                  }}</label>
                  <div class="flex min-w-0 flex-col gap-2">
                    <BaseSelect
                      v-model="selectedBuildId"
                      :options="workspaceBuildOptions"
                      :placeholder="$t('newInstall.selectWorkspaceBuild')"
                      :loading="authStore.loadingBuilds"
                      :loading-label="$t('newInstall.refreshingWorkspaceBuilds')"
                      :disabled="workspaceBuildOptions.length === 0"
                      :aria-label="$t('newInstall.workspaceBuildLabel')"
                    />
                    <div class="workspace-build-actions flex items-center gap-2">
                      <Button
                        size="link"
                        variant="link"
                        type="button"
                        class="workspace-build-online text-[12.5px]"
                        :disabled="initializing"
                        @click="openBuildsPage"
                      >
                        {{ $t('newInstall.viewBuildsOnline') }}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="muted-textonly"
                        type="button"
                        class="workspace-build-refresh rounded-[8px]"
                        :title="$t('newInstall.refreshWorkspaceBuilds')"
                        :aria-label="$t('newInstall.refreshWorkspaceBuilds')"
                        :disabled="authStore.loadingBuilds || authorizingWorkspace"
                        @click="refreshManagedBuilds"
                      >
                        <RefreshCw
                          :size="14"
                          :class="{
                            'workspace-build-refresh__icon--spinning animate-spin [animation-duration:800ms]':
                              authStore.loadingBuilds
                          }"
                          aria-hidden="true"
                        />
                      </Button>
                    </div>
                    <Button
                      v-if="authStore.buildsError"
                      size="md"
                      variant="destructive-textonly"
                      type="button"
                      class="wizard-build-retry whitespace-normal text-left"
                      :disabled="authStore.loadingBuilds || authorizingWorkspace"
                      @click="refreshManagedBuilds"
                    >
                      {{ $t('devPlatform.build.loadError') }}
                    </Button>
                    <div
                      v-else-if="
                        !authorizingWorkspace &&
                        !authStore.loadingBuilds &&
                        workspaceBuildOptions.length === 0
                      "
                      class="config-loading text-[13px] text-text-muted"
                    >
                      {{ $t('newInstall.noCompatibleBuilds') }}
                    </div>
                  </div>
                </div>

                <div
                  v-if="selectedBuildTargetOptions.length > 0"
                  class="config-form-row config-field grid grid-cols-[148px_minmax(0,1fr)] items-start gap-4 py-3"
                  data-testid="workspace-build-targets"
                >
                  <label class="config-label pt-3.5 text-[13px] font-medium text-text-muted">{{
                    $t('newInstall.buildTarget')
                  }}</label>
                  <SetupOptionCards
                    :options="buildTargetCards"
                    :selected-value="selectedBuildTargetId"
                    :aria-label="$t('newInstall.buildTarget')"
                    @select="selectedBuildTargetId = $event"
                  />
                </div>
              </template>

              <div
                v-else-if="currentSource"
                id="source-fields"
                class="config-advanced config-advanced--direct is-open flex flex-col"
              >
                <template v-for="(field, fieldIndex) in currentSource.fields" :key="field.id">
                  <InstallLocationRow
                    v-if="field.id === HARDWARE_FIELD_ID && locationBeforeHardware"
                    :path="instPath"
                    :free-label="diskFreeLabel"
                    :short-label="diskShortLabel"
                    :path-issues="pathIssues"
                    :disk-space-loading="diskSpaceLoading"
                    :disk-space="diskSpace"
                    :estimated-size="estimatedInstallSize"
                    @browse="handleBrowse"
                    @open="handleOpenInstPath"
                  />
                  <div
                    v-show="!isHiddenWhenEmpty(field) && !isInlinedField(field)"
                    class="config-form-row config-source-field grid grid-cols-[148px_minmax(0,1fr)] gap-4 py-3"
                    :class="field.renderAs === 'cards' ? 'items-start' : 'items-center'"
                  >
                    <label
                      class="config-label text-[13px] font-medium text-text-muted"
                      :class="field.renderAs === 'cards' && 'pt-3.5'"
                      :for="`sf-${field.id}`"
                      >{{ field.label }}</label
                    >

                    <div v-if="field.type === 'text'" class="flex min-w-0 flex-col">
                      <div class="config-text-action flex items-stretch gap-2">
                        <InputGroup
                          class="config-input config-source-text min-w-0 flex-auto"
                          :class="{ 'config-input--invalid': field.id === 'url' && urlFieldError }"
                        >
                          <InputGroupInput
                            :id="`sf-${field.id}`"
                            type="text"
                            :model-value="textFieldValues.get(field.id) ?? ''"
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
                        </InputGroup>
                        <Button
                          v-if="field.action"
                          :id="`sf-${field.id}-action`"
                          size="lg"
                          variant="secondary"
                          type="button"
                          class="shrink-0"
                          @click="handleTextAction(field)"
                        >
                          {{ field.action.label }}
                        </Button>
                      </div>
                      <div
                        v-if="fieldErrors.get(field.id)"
                        class="config-field-error mt-1.5 text-[13px] text-[var(--danger)]"
                      >
                        {{ fieldErrors.get(field.id) }}
                      </div>
                      <div
                        v-else-if="field.id === 'url' && urlFieldError"
                        :id="`sf-${field.id}-error`"
                        class="config-field-error mt-1.5 text-[13px] text-[var(--danger)]"
                        role="alert"
                      >
                        {{ urlFieldError }}
                      </div>
                    </div>

                    <div v-else-if="field.renderAs === 'cards'" class="min-w-0">
                      <div
                        v-if="fieldLoading.get(field.id)"
                        class="config-loading py-3 text-[13px] text-text-muted"
                        :class="spinnerClass"
                      >
                        {{ $t('newInstall.loading') }}
                      </div>
                      <SetupOptionCards
                        v-else-if="
                          fieldOptions.has(field.id) &&
                          (fieldOptions.get(field.id)?.length ?? 0) > 0
                        "
                        :options="
                          field.id === HARDWARE_FIELD_ID
                            ? toHardwareCards(sortedCardOptions(fieldOptions.get(field.id)!))
                            : toOptionCards(sortedCardOptions(fieldOptions.get(field.id)!))
                        "
                        :selected-value="selections[field.id]?.value ?? null"
                        :aria-label="field.label"
                        @select="(value) => selectCardOptionByValue(field, fieldIndex, value)"
                      />
                      <div
                        v-else-if="fieldOptions.has(field.id)"
                        class="config-loading py-3 text-[13px] text-text-muted"
                      >
                        {{
                          fieldErrors.get(field.id)
                            ? `Error: ${fieldErrors.get(field.id)}`
                            : $t('newInstall.noOptions')
                        }}
                      </div>
                    </div>

                    <div
                      v-else-if="isSegmentedRelease(field)"
                      class="config-release flex min-w-0 flex-wrap items-center gap-2"
                      data-testid="config-release"
                    >
                      <SegmentedControl
                        :model-value="selections[field.id]?.value ?? ''"
                        :options="releaseChoices ?? []"
                        :label="field.label"
                        @update:model-value="selectReleaseChoice(field, fieldIndex, $event)"
                      />
                      <BaseSelect
                        v-if="inlineVersionField"
                        class="config-release-version w-auto flex-none gap-2.5"
                        compact
                        leading="ComfyUI"
                        :model-value="selections[inlineVersionField.id]?.value ?? ''"
                        :options="getSelectOptions(inlineVersionField)"
                        :placeholder="getSelectPlaceholder(inlineVersionField)"
                        :disabled="
                          fieldLoading.get(inlineVersionField.id) ||
                          (fieldOptions.get(inlineVersionField.id)?.length ?? 0) === 0
                        "
                        :aria-label="inlineVersionField.label"
                        @update:model-value="
                          onSelectFieldChange(inlineVersionField, versionFieldIndex, $event)
                        "
                      />
                    </div>

                    <BaseSelect
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
              </div>

              <InstallLocationRow
                v-if="showLocation && !locationBeforeHardware"
                :path="instPath"
                :free-label="diskFreeLabel"
                :short-label="diskShortLabel"
                :path-issues="pathIssues"
                :disk-space-loading="diskSpaceLoading"
                :disk-space="diskSpace"
                :estimated-size="estimatedInstallSize"
                @browse="handleBrowse"
                @open="handleOpenInstPath"
              />

              <div
                v-if="remoteSource || offersBuildImport"
                class="config-form-row config-other-ways grid grid-cols-[148px_minmax(0,1fr)] items-center gap-4 py-3"
                data-testid="config-other-ways"
              >
                <span class="config-label text-[13px] font-medium text-text-muted">{{
                  remoteSelected ? '' : $t('newInstall.alreadyHaveComfy')
                }}</span>
                <p
                  class="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] leading-[18px] text-text-muted"
                >
                  <Button
                    v-if="remoteSelected"
                    size="link"
                    variant="link"
                    type="button"
                    class="config-install-here text-[12.5px] text-neutral-100 underline decoration-neutral-100/40 underline-offset-[3px] transition-[text-decoration-color] duration-160 hover:decoration-neutral-100"
                    data-testid="install-source-here"
                    @click="selectStandaloneSource"
                  >
                    {{ $t('newInstall.installHereInstead') }}
                  </Button>
                  <template v-else>
                    <Button
                      v-if="remoteSource"
                      size="link"
                      variant="link"
                      type="button"
                      class="config-connect-remote text-[12.5px] text-neutral-100 underline decoration-neutral-100/40 underline-offset-[3px] transition-[text-decoration-color] duration-160 hover:decoration-neutral-100"
                      data-testid="install-source-remote"
                      :disabled="authorizingWorkspace"
                      @click="selectRemoteSource"
                    >
                      {{ $t('newInstall.connectToServer') }}
                    </Button>
                    <template v-if="offersBuildImport">
                      <span v-if="remoteSource" aria-hidden="true">·</span>
                      <Button
                        size="link"
                        variant="link"
                        type="button"
                        class="config-add-existing text-[12.5px] text-neutral-100 underline decoration-neutral-100/40 underline-offset-[3px] transition-[text-decoration-color] duration-160 hover:decoration-neutral-100"
                        data-testid="config-add-existing"
                        @click="emit('show-build-import', 'track')"
                      >
                        {{ $t('newInstall.addExistingBuild') }}
                      </Button>
                      <span aria-hidden="true">·</span>
                      <Button
                        size="link"
                        variant="link"
                        type="button"
                        class="config-load-snapshot text-[12.5px] text-neutral-100 underline decoration-neutral-100/40 underline-offset-[3px] transition-[text-decoration-color] duration-160 hover:decoration-neutral-100"
                        data-testid="config-load-snapshot"
                        @click="emit('show-build-import', 'load-snapshot')"
                      >
                        {{ $t('newInstall.loadSnapshot') }}
                      </Button>
                    </template>
                  </template>
                </p>
              </div>
            </div>
          </template>

          <template v-else-if="step === 'template'">
            <h2
              class="wizard-title m-0 text-[18px] leading-7 font-semibold tracking-[-0.01em] text-neutral-100"
            >
              {{ $t('standalone.templatePickerTitle') }}
            </h2>
            <p class="wizard-lead m-0 mt-1 mb-4 text-[13px] leading-5 text-text-muted">
              {{ $t('standalone.templatePickerLead') }}
            </p>
            <div class="template-shell flex flex-col">
              <div
                v-if="hasTemplateAlerts"
                id="tps-alerts"
                class="template-alerts mb-3 flex w-full flex-col gap-2"
                :class="{
                  'template-alerts--nudge animate-[install-template-alert-shake_400ms_cubic-bezier(0.36,0.07,0.19,0.97)_both] motion-reduce:animate-none':
                    templateAlertNudge
                }"
              >
                <div
                  v-if="templateDiskError"
                  class="template-alert template-alert--error flex items-start gap-2 rounded-[10px] bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-3 py-2.5 text-[13px] leading-[1.4] text-[var(--danger)] [&_svg]:mt-px [&_svg]:flex-none"
                  role="alert"
                >
                  <CircleAlert :size="16" aria-hidden="true" />
                  <span>{{ templateDiskError }}</span>
                </div>
              </div>
              <TemplatePickerStep
                ref="pickerRef"
                :options="templateOptions"
                :none-value="NO_TEMPLATE_VALUE"
                :selected-value="selections.bundledTemplate?.value ?? null"
                :disk-space="diskSpace"
                :disk-space-loading="diskSpaceLoading"
                @select="selectTemplate"
              />
              <label
                v-if="hasLocalInstall"
                class="template-shell__opt-out mt-4 flex w-full cursor-pointer items-center gap-2.5 text-[13px] leading-[1.4] text-text-muted"
              >
                <Checkbox
                  :model-value="dontShowTemplatePicker"
                  @update:model-value="dontShowTemplatePicker = $event === true"
                />
                <span class="template-opt-out-label">{{
                  $t('standalone.templateDontShowAgain')
                }}</span>
              </label>
            </div>
          </template>
        </div>

        <footer
          class="install-wizard-foot flex min-h-16 flex-none items-center gap-2 px-8 py-3 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.08)]"
        >
          <template v-if="step === 'configure' && view === 'change'">
            <span class="flex-1" />
            <Button
              size="lg"
              variant="secondary"
              type="button"
              class="h-9 rounded-[10px] config-discard-changes"
              data-testid="config-discard-changes"
              @click="discardChangeSetup"
            >
              {{ $t('newInstall.discardChanges') }}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="inverted"
              class="h-9 rounded-[10px] config-save-changes min-w-[104px]"
              data-testid="config-save-changes"
              @click="saveChangeSetup"
            >
              {{ $t('newInstall.saveChanges') }}
            </Button>
          </template>
          <template v-else-if="step === 'configure'">
            <Button
              v-if="cameFromLocalBranch"
              size="lg"
              variant="textonly"
              type="button"
              class="h-9 rounded-[10px] config-back -ml-3"
              data-testid="config-back-to-local-branch"
              @click="handleBackToLocalBranch"
            >
              <ArrowLeft :size="16" aria-hidden="true" />
              {{ $t('common.back') }}
            </Button>
            <span class="flex-1" />
            <Button
              type="button"
              size="lg"
              variant="inverted"
              class="h-9 rounded-[10px] config-continue min-w-[104px]"
              :disabled="!canContinue"
              @click="handleConfigureContinue"
            >
              {{ primaryLabel }}
            </Button>
          </template>
          <template v-else>
            <Button
              size="lg"
              variant="textonly"
              type="button"
              class="h-9 rounded-[10px] template-back -ml-3"
              @click="backToConfigure"
            >
              <ArrowLeft :size="16" aria-hidden="true" />
              {{ $t('common.back') }}
            </Button>
            <span class="flex-1" />
            <Button
              size="lg"
              variant="textonly"
              type="button"
              class="h-9 rounded-[10px] template-skip"
              :aria-label="$t('standalone.templateSkipAndInstallAria')"
              @click="handleTemplateSkip"
            >
              {{ $t('standalone.templateSkipAndInstall') }}
            </Button>
            <Button
              size="lg"
              variant="inverted"
              type="button"
              class="h-9 rounded-[10px] template-install min-w-[104px]"
              :class="{
                'template-install--blocked cursor-not-allowed opacity-55': templateInstallBlocked
              }"
              :aria-disabled="templateInstallBlocked"
              :aria-describedby="templateInstallBlocked ? 'tps-alerts' : undefined"
              @click="handleTemplateInstall"
            >
              {{ $t('standalone.templateInstall') }}
            </Button>
          </template>
        </footer>
      </section>
    </div>
  </component>
</template>

<style>
@keyframes install-template-alert-shake {
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
</style>
