<script setup lang="ts">
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'
import { ref, computed, watch, onMounted, onBeforeUnmount, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { HardDrive, CircleAlert, RefreshCw } from 'lucide-vue-next'
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
import { stripVariantPrefix, sortedCardOptions } from '../lib/variants'
import { INSTALL_SPACE_FACTOR } from '../lib/setupPlan'
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
import TakeoverBack from '../components/TakeoverBack.vue'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import BrandVariantList from '../components/BrandVariantList.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'
import TooltipWrap from '../components/ui/Tooltip.vue'
import { BaseSelect, type BaseSelectOption } from '../components/ui'
import type { Build, BuildTarget } from '../devplatform/types'

const emit = defineEmits<{
  close: []
  'show-progress': [opts: ShowProgressOpts]
  'navigate-list': []
  'back-to-setup': []
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
    return sizeBytes > 0 ? Math.ceil(sizeBytes * INSTALL_SPACE_FACTOR) : 0
  }
  let downloadBytes = 0
  for (const selected of Object.values(selections.value)) {
    const files = selected?.data?.downloadFiles as Array<{ size: number }> | undefined
    if (files) {
      downloadBytes += files.reduce((sum, f) => sum + f.size, 0)
    }
  }
  return downloadBytes > 0 ? Math.ceil(downloadBytes * INSTALL_SPACE_FACTOR) : 0
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
  if (!resolved.value && !currentSource.value?.skipInstall) {
    emitTelemetryAction('comfy.desktop.install.not_started', {
      ...installHandoffProps(),
      reason: 'wizard_cancelled'
    })
  }
  clearTimeout(templateNudgeTimer)
})

function handleBackToSetup(): void {
  resolved.value = true
  emitTelemetryAction('comfy.desktop.install.not_started', {
    ...installHandoffProps(),
    reason: 'back_to_setup'
  })
  emit('back-to-setup')
}

interface OpenOpts {
  cameFromSetup?: boolean
  entrypoint?: string
  workspaceId?: string
}

const cameFromSetup = ref(false)

async function open(opts: OpenOpts = {}): Promise<void> {
  loadGeneration++
  const gen = ++modeGeneration
  instName.value = ''
  workspaceId.value = opts.workspaceId?.trim() || PERSONAL_WORKSPACE_ID
  workspaceInstallMode.value = 'public'
  selectedBuildId.value = ''
  selectedBuildTargetId.value = ''
  cameFromSetup.value = opts.cameFromSetup === true
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

    if (options.length > 0) {
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
      const estimatedRequired =
        downloadBytes > 0 ? Math.ceil(downloadBytes * INSTALL_SPACE_FACTOR) : 0

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

function isHiddenWhenEmpty(field: SourceField): boolean {
  if (field.id === 'bundledTemplate' && shouldShowPickerStep.value) return true
  if (field.type === 'text' || field.renderAs === 'cards') return false
  const options = fieldOptions.value.get(field.id)
  if (options === undefined) return false
  return options.length === 0 && !fieldLoading.value.get(field.id)
}

defineExpose({ open })
</script>

<template>
  <BrandTakeoverLayout
    :scroll-content="step === 'configure'"
    :aria-label="
      $t(step === 'template' ? 'standalone.templatePickerTitle' : 'newInstall.configureTitle')
    "
  >
    <div
      v-if="step === 'configure'"
      class="config-shell mx-auto w-full max-w-[640px] self-stretch pt-[clamp(1.5rem,4vh,3rem)] pb-[max(5rem,8vh)] text-center"
    >
      <h1
        class="wizard-title m-0 font-display text-[length:var(--takeover-fs-title)] leading-[1.15] font-extrabold tracking-normal text-[var(--legacy-color-text)] text-center opacity-85"
      >
        {{ $t('newInstall.configureTitle') }}
      </h1>
      <p
        class="wizard-lead mt-[var(--takeover-gap-sm)] mb-[var(--takeover-gap-md)] font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-200 text-center"
      >
        {{ $t('chooser.newInstallDesc') }}
      </p>
      <div
        class="config-card w-full overflow-hidden rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] text-left [backdrop-filter:blur(var(--brand-surface-blur))]"
      >
        <div class="config-card__body flex flex-col gap-[18px] p-5">
          <div
            v-if="authorizingWorkspace"
            class="workspace-authorization-status w-full text-[13px] leading-[1.4] text-neutral-200"
            :class="spinnerClass"
            role="status"
            data-testid="workspace-authorization-status"
          >
            {{ $t('newInstall.waitingForWorkspaceAuthorization') }}
          </div>
          <div class="config-field flex flex-col gap-2">
            <label class="config-label text-[13px] text-neutral-200" for="inst-name-standalone">{{
              $t('common.name')
            }}</label>
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
              class="config-field-error mt-1 min-h-0 text-[13px] text-[var(--danger)]"
              role="alert"
            >
              {{ nameError }}
            </div>
          </div>

          <div
            v-if="sources.length > 0"
            class="config-method-row mb-4 flex flex-wrap gap-2"
            role="radiogroup"
            :aria-label="$t('newInstall.chooseMethod')"
            data-testid="install-source-tabs"
          >
            <template v-for="tab in installSourceTabs" :key="tab.key">
              <Button
                v-if="tab.kind === 'managed'"
                size="lg"
                variant="outline"
                type="button"
                role="radio"
                data-testid="workspace-install-source-managed"
                :aria-checked="managedBuildMode"
                :disabled="authorizingWorkspace"
                :class="{ 'config-method--selected ring-1 ring-ring': managedBuildMode }"
                @click="selectManagedInstallMode"
              >
                {{ $t('newInstall.managedBuilds') }}
              </Button>
              <Button
                v-else
                size="lg"
                variant="outline"
                type="button"
                role="radio"
                :data-testid="`install-source-${tab.source.id}`"
                :aria-checked="!managedBuildMode && currentSource?.id === tab.source.id"
                :disabled="authorizingWorkspace"
                :class="{
                  'config-method--selected ring-1 ring-ring':
                    !managedBuildMode && currentSource?.id === tab.source.id
                }"
                @click="selectSourceCard(tab.source)"
              >
                {{
                  tab.source.id === 'standalone' ? $t('newInstall.publicBuilds') : tab.source.label
                }}
              </Button>
            </template>
          </div>

          <div
            v-if="managedBuildMode"
            class="config-field flex flex-col gap-2"
            data-testid="workspace-build-field"
          >
            <div class="workspace-build-label-row flex items-center justify-between">
              <label class="config-label text-[13px] text-neutral-200">{{
                $t('newInstall.workspaceBuildLabel')
              }}</label>
              <div class="workspace-build-actions flex items-center gap-2">
                <Button
                  size="link"
                  variant="link"
                  type="button"
                  class="workspace-build-online"
                  :disabled="initializing"
                  @click="openBuildsPage"
                >
                  {{ $t('newInstall.viewBuildsOnline') }}
                </Button>
                <Button
                  size="icon-sm"
                  variant="muted-textonly"
                  type="button"
                  class="workspace-build-refresh"
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
              class="config-loading py-3 text-sm leading-[inherit] text-text-muted"
            >
              {{ $t('newInstall.noCompatibleBuilds') }}
            </div>
          </div>

          <div
            v-if="managedBuildMode && selectedBuildTargetOptions.length > 0"
            class="config-field flex flex-col gap-2"
            data-testid="workspace-build-targets"
          >
            <label class="config-label text-[13px] text-neutral-200">{{
              $t('newInstall.buildTarget')
            }}</label>
            <BrandVariantList
              :options="selectedBuildTargetOptions"
              :selected-value="selectedBuildTargetId"
              :aria-label="$t('newInstall.buildTarget')"
              @select="selectedBuildTargetId = $event.value"
            />
          </div>

          <div
            v-if="!managedBuildMode"
            class="config-advanced config-advanced--direct is-open border-0 pt-0"
          >
            <div class="config-advanced__wrap block">
              <div
                class="config-advanced__body -mx-[3px] mt-0 min-h-0 overflow-hidden px-[3px] opacity-100 [transform:translateY(0)] [transition:opacity_220ms_ease_60ms,transform_260ms_cubic-bezier(0.22,1,0.36,1)_40ms]"
              >
                <div
                  v-if="sourceError"
                  class="config-error py-3 text-sm leading-[inherit] text-[var(--danger)]"
                >
                  {{ sourceError }}
                </div>
                <div v-if="currentSource" id="source-fields" class="flex flex-col gap-4">
                  <div
                    v-for="(field, fieldIndex) in currentSource.fields"
                    v-show="!isHiddenWhenEmpty(field)"
                    :key="field.id"
                    class="config-source-field mt-0 flex flex-col gap-2"
                  >
                    <label
                      class="config-label text-[13px] text-neutral-200"
                      :for="`sf-${field.id}`"
                      >{{ field.label }}</label
                    >

                    <template v-if="field.type === 'text'">
                      <div class="config-text-action mt-1.5 flex items-stretch gap-2">
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
                          :class="['shrink-0']"
                          @click="handleTextAction(field)"
                        >
                          {{ field.action.label }}
                        </Button>
                      </div>
                      <div
                        v-if="fieldErrors.get(field.id)"
                        class="config-field-error mt-1 min-h-0 text-[13px] text-[var(--danger)]"
                      >
                        {{ fieldErrors.get(field.id) }}
                      </div>
                      <div
                        v-else-if="field.id === 'url' && urlFieldError"
                        :id="`sf-${field.id}-error`"
                        class="config-field-error mt-1 min-h-0 text-[13px] text-[var(--danger)]"
                        role="alert"
                      >
                        {{ urlFieldError }}
                      </div>
                    </template>

                    <template v-else-if="field.renderAs === 'cards'">
                      <div
                        v-if="fieldLoading.get(field.id)"
                        class="config-loading py-3 text-sm leading-[inherit] text-text-muted"
                        :class="spinnerClass"
                      >
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
                      <div
                        v-else-if="fieldOptions.has(field.id)"
                        class="config-loading py-3 text-sm leading-[inherit] text-text-muted"
                      >
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

          <TooltipWrap
            class="config-field-wrap w-full flex-col [&.config-field-wrap]:flex"
            side="bottom"
            :text="currentSource?.skipInstall ? $t('newInstall.notAvailableRemote') : ''"
          >
            <div
              class="config-field flex flex-col gap-2"
              :class="{
                'config-field--disabled opacity-50 [&_input]:pointer-events-none [&_button]:pointer-events-none [&_.config-input]:pointer-events-none':
                  currentSource?.skipInstall
              }"
              data-testid="install-location-field"
            >
              <label class="config-label text-[13px] text-neutral-200">{{
                $t('newInstall.installLocation')
              }}</label>
              <div class="config-path-row flex items-stretch gap-2">
                <InputGroup class="config-input config-path-input min-w-0 flex-auto gap-2.5 px-3">
                  <HardDrive :size="14" aria-hidden="true" />
                  <Button
                    v-if="!currentSource?.skipInstall && instPath"
                    size="link"
                    variant="link"
                    type="button"
                    class="config-path-open block min-w-0 flex-[0_1_auto] truncate py-0 text-left text-inherit"
                    :title="$t('actions.openDirectory')"
                    :aria-label="`${$t('actions.openDirectory')}: ${instPath}`"
                    @click="handleOpenInstPath"
                  >
                    {{ instPath }}
                  </Button>
                  <span
                    v-else
                    class="config-path-open config-path-open--static min-w-0 flex-[0_1_auto] cursor-default overflow-hidden border-0 bg-transparent p-0 text-left [font:inherit] text-ellipsis whitespace-nowrap text-inherit"
                    >{{ instPath }}</span
                  >
                </InputGroup>
                <Button
                  size="lg"
                  variant="secondary"
                  :class="['h-10 px-3.5 py-0 text-[13px]']"
                  type="button"
                  :disabled="!!currentSource?.skipInstall"
                  @click="handleBrowse"
                >
                  {{ $t('common.browse') }}
                </Button>
              </div>
              <div class="config-install-meta flex items-end gap-1">
                <div v-if="!currentSource?.skipInstall" class="config-install-disk min-w-0">
                  <PathDiskInfo
                    :path-issues="pathIssues"
                    :disk-space-loading="diskSpaceLoading"
                    :disk-space="diskSpace"
                    :estimated-size="estimatedInstallSize"
                  />
                </div>
                <span
                  v-if="!currentSource?.skipInstall"
                  class="config-install-separator mt-1 min-h-[18px] flex-none text-[13px] text-text-muted"
                  aria-hidden="true"
                  >·</span
                >
                <div
                  class="config-gpu-value mt-1 min-h-[18px] flex-none text-[13px] text-text-muted"
                  data-testid="detected-gpu-field"
                >
                  {{ detectedGpu }}
                </div>
              </div>
              <div
                v-if="hardwareWarning && !currentSource?.skipInstall"
                class="config-hardware-warning mt-1.5 text-[12px] leading-[1.4] text-[var(--warning)]"
                role="alert"
                data-testid="wizard-hardware-warning"
              >
                {{ hardwareWarning }}
              </div>
            </div>
          </TooltipWrap>
        </div>

        <div
          v-if="cameFromSetup"
          class="config-card__footer flex flex-none items-center justify-end gap-3 border-t border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-5 py-3.5"
        >
          <Button
            size="lg"
            variant="textonly"
            type="button"
            class="config-back mr-auto"
            data-testid="config-back-to-setup"
            @click="handleBackToSetup"
          >
            {{ $t('common.back') }}
          </Button>
        </div>
      </div>
    </div>

    <div
      v-else-if="step === 'template'"
      class="template-shell mx-auto flex h-full max-h-full min-h-0 w-full max-w-[960px] flex-col items-center justify-center self-stretch py-[clamp(1.5rem,4vh,3rem)] text-center"
    >
      <h1
        class="wizard-title m-0 font-display text-[length:var(--takeover-fs-title)] leading-[1.15] font-extrabold tracking-normal text-[var(--legacy-color-text)] text-center opacity-85"
      >
        {{ $t('standalone.templatePickerTitle') }}
      </h1>
      <p
        class="wizard-lead mt-[var(--takeover-gap-md)] mb-[var(--takeover-gap-lg)] font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-200 text-center"
      >
        {{ $t('standalone.templatePickerLead') }}
      </p>
      <div
        v-if="hasTemplateAlerts"
        id="tps-alerts"
        class="template-alerts mb-3 flex w-full flex-col gap-2 text-left"
        :class="{
          'template-alerts--nudge animate-[install-template-alert-shake_400ms_cubic-bezier(0.36,0.07,0.19,0.97)_both] motion-reduce:animate-none':
            templateAlertNudge
        }"
      >
        <div
          v-if="templateDiskError"
          class="template-alert template-alert--error flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-3 py-2.5 text-[length:var(--takeover-fs-caption)] leading-[1.4] text-[var(--danger)] [box-shadow:inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_28%,transparent)] [&_svg]:mt-px [&_svg]:flex-none"
          role="alert"
        >
          <CircleAlert :size="16" aria-hidden="true" />
          <span>{{ templateDiskError }}</span>
        </div>
      </div>
      <div
        class="template-card flex max-h-[min(80vh,100%)] w-full flex-col overflow-hidden rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] text-left [backdrop-filter:blur(var(--brand-surface-blur))]"
      >
        <div
          class="template-card__body flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
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
        <div
          class="template-card__footer flex flex-none flex-col items-stretch justify-end gap-3 border-t border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-5 py-3.5"
        >
          <div class="template-card__footer-actions flex items-center justify-end gap-3">
            <Button
              size="lg"
              variant="textonly"
              type="button"
              class="template-skip"
              :class="[
                'h-[34px] border-[var(--brand-surface-border)] px-3.5 py-0 text-[length:var(--takeover-fs-caption)] text-neutral-200 enabled:hover:border-[var(--brand-surface-border-hover)]'
              ]"
              :aria-label="$t('standalone.templateSkipAndInstallAria')"
              @click="handleTemplateSkip"
            >
              {{ $t('standalone.templateSkipAndInstall') }}
            </Button>
            <Button
              size="lg"
              variant="inverted"
              type="button"
              class="template-install"
              :class="[
                'h-[34px] min-w-[104px] px-3.5 py-0 text-[length:var(--takeover-fs-caption)]',
                {
                  'template-install--blocked cursor-not-allowed opacity-55': templateInstallBlocked
                }
              ]"
              :aria-disabled="templateInstallBlocked"
              :aria-describedby="templateInstallBlocked ? 'tps-alerts' : undefined"
              @click="handleTemplateInstall"
            >
              {{ $t('standalone.templateInstall') }}
            </Button>
          </div>
        </div>
      </div>
      <label
        v-if="hasLocalInstall"
        class="template-shell__opt-out mt-3.5 flex w-full cursor-pointer items-center justify-center gap-2.5 text-[length:var(--takeover-fs-caption)] leading-[1.4] text-neutral-400"
      >
        <Checkbox
          :model-value="dontShowTemplatePicker"
          @update:model-value="dontShowTemplatePicker = $event === true"
        />
        <span class="template-opt-out-label flex flex-col gap-0.5 leading-[1.4]">{{
          $t('standalone.templateDontShowAgain')
        }}</span>
      </label>
    </div>

    <template #footer-left>
      <TakeoverBack
        v-if="step === 'template'"
        class="config-back-to-dashboard bottom-[clamp(1.25rem,2vw,2rem)] left-[clamp(1.25rem,2vw,2rem)] z-2 [&.config-back-to-dashboard]:absolute"
        :label="$t('common.back')"
        @back="step = 'configure'"
      />
      <TakeoverBack
        v-else-if="!hideBackToDashboard"
        class="config-back-to-dashboard bottom-[clamp(1.25rem,2vw,2rem)] left-[clamp(1.25rem,2vw,2rem)] z-2 [&.config-back-to-dashboard]:absolute"
        :label="$t('common.backToDashboard')"
        @back="emit('close')"
      />
    </template>
    <template #footer>
      <Button
        v-if="step === 'configure'"
        type="button"
        size="lg"
        variant="inverted"
        class="config-continue right-[clamp(1.25rem,2vw,2rem)] bottom-[clamp(1.25rem,2vw,2rem)] z-2 min-w-[120px] [&.config-continue]:absolute"
        :disabled="!canContinue"
        @click="handleConfigureContinue"
      >
        {{ $t('common.continue') }}
      </Button>
    </template>
  </BrandTakeoverLayout>
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
