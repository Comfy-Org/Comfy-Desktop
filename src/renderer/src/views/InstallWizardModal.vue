<script setup lang="ts">
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
  Check,
  Download,
  FileArchive,
  FolderArchive,
  Globe,
  HardDrive,
  MapPin,
  Monitor,
  Package,
  RefreshCw,
  SlidersHorizontal,
  Tag,
  Users,
  Zap
} from '@lucide/vue'
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
  ShowProgressOpts,
  SystemInfo
} from '../types/ipc'
import { stripVariantPrefix, sortedCardOptions } from '../lib/variants'
import {
  INSTALL_SPACE_FACTOR,
  downloadBytesOf,
  isCpuVariant,
  machineName,
  type ChangeSetupDraft,
  type NewInstallSetup,
  type SavedSetup,
  type SetupPlan
} from '../lib/setupPlan'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { PERSONAL_WORKSPACE_ID, workspaceContextId } from '../../../shared/workspaces'
import { emitTelemetryAction, toVariantBucket, toErrorBucket } from '../lib/telemetry'
import {
  trackGuardrailBlocked,
  createDiskSpaceChecker,
  showPathIssueAlerts,
  checkNvidiaDriverOrWarn,
  checkDiskSpaceOrWarn
} from '../lib/installHelpers'
import SetupModal from '../components/SetupModal.vue'
import TermsModal from '../components/TermsModal.vue'
import TermsConsentRow from '../components/TermsConsentRow.vue'
import InstallNameInput from '../components/InstallNameInput.vue'
import TrackBuildForm from '../components/TrackBuildForm.vue'
import LoadSnapshotForm from '../components/LoadSnapshotForm.vue'
import SetupMachineIllustration from '../components/SetupMachineIllustration.vue'
import SetupOptionCards, { type SetupOptionCard } from '../components/SetupOptionCards.vue'
import { toHardwareCards, toOptionCards } from '../lib/setupOptionCards'
import InstallLocationRow from '../components/InstallLocationRow.vue'
import SetupFormRow from '../components/SetupFormRow.vue'
import SetupSummaryRow from '../components/SetupSummaryRow.vue'
import PathOpenButton from '../components/PathOpenButton.vue'
import PathDiskInfo from '../components/PathDiskInfo.vue'
import { BaseSelect, type BaseSelectOption } from '../components/ui'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import { formatBytes, formatFreeSpace } from '../lib/formatting'
import type { Build, BuildTarget } from '../devplatform/types'

const emit = defineEmits<{
  close: []
  'show-progress': [opts: ShowProgressOpts]
  'navigate-list': []
  'back-to-setup': []
  'save-setup': [saved: SavedSetup]
  'consent-change': [accepted: boolean]
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
const systemInfo = ref<SystemInfo | null>(null)
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
const setupPicked = computed(
  () => !initializing.value || (localInstallMode.value && currentSource.value !== null)
)

type InstallSourceTab =
  { key: 'managed'; kind: 'managed' } | { key: string; kind: 'source'; source: Source }

const installSourceTabs = computed<InstallSourceTab[]>(() => {
  const sourceOrder = new Map([
    ['standalone', 0],
    ['portable', 1],
    ['remote', 2]
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

function connectsToExistingComfy(tab: InstallSourceTab): boolean {
  return tab.kind === 'source' && tab.source.skipInstall === true
}

const newInstallTabs = computed(() =>
  installSourceTabs.value.filter((tab) => !connectsToExistingComfy(tab))
)
const existingComfyTabs = computed(() => installSourceTabs.value.filter(connectsToExistingComfy))

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

interface HeldField {
  options: FieldOption[]
  selection: FieldOption | undefined
  hidden: boolean
}

const heldFields = ref(new Map<string, HeldField>())

function holdFieldsFrom(source: Source, fromIndex: number): void {
  for (const field of source.fields.slice(fromIndex)) {
    const options = fieldOptions.value.get(field.id)
    if (!options || heldFields.value.has(field.id)) continue
    heldFields.value.set(field.id, {
      options,
      selection: selections.value[field.id],
      hidden: isHiddenWhenEmpty(field)
    })
  }
}

function releaseFieldsFrom(source: Source, fromIndex: number): void {
  for (const field of source.fields.slice(fromIndex)) heldFields.value.delete(field.id)
}

function isRefreshing(field: SourceField): boolean {
  return heldFields.value.has(field.id)
}

function shownOptions(field: SourceField): FieldOption[] | undefined {
  return fieldOptions.value.get(field.id) ?? heldFields.value.get(field.id)?.options
}

const shownSelections = computed(() => {
  const shown: Record<string, FieldOption> = {}
  for (const [fieldId, held] of heldFields.value) {
    if (held.selection) shown[fieldId] = held.selection
  }
  return { ...shown, ...selections.value }
})

const {
  diskSpace,
  diskSpaceLoading,
  pathIssues,
  fetchDiskSpace,
  reset: resetDiskSpace
} = createDiskSpaceChecker()
let hardwareValidation: HardwareValidation | null = null

function installSizeOf(picked: Record<string, FieldOption>): number {
  let downloadBytes = 0
  for (const selected of Object.values(picked)) {
    const files = selected?.data?.downloadFiles as Array<{ size: number }> | undefined
    if (files) {
      downloadBytes += files.reduce((sum, f) => sum + f.size, 0)
    }
  }
  return downloadBytes > 0 ? Math.ceil(downloadBytes * INSTALL_SPACE_FACTOR) : 0
}

const estimatedInstallSize = computed(() => {
  if (!localInstallMode.value) {
    const sizeBytes = selectedBuild.value?.sizeBytes ?? 0
    return sizeBytes > 0 ? Math.ceil(sizeBytes * INSTALL_SPACE_FACTOR) : 0
  }
  return installSizeOf(selections.value)
})

const shownInstallSize = computed(() =>
  localInstallMode.value ? installSizeOf(shownSelections.value) : estimatedInstallSize.value
)

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

const offersBuildImport = computed(() => !props.hideBackToDashboard)

async function handleConfigureContinue(): Promise<void> {
  if (needsConsent.value && !consentAccepted.value) {
    consentNudge.value = true
    return
  }
  if (startFrom.value === 'existing') {
    await useExistingComfy()
    return
  }
  await handleSave()
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
        gpuName.value = gpu.model || gpu.label
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

  Promise.resolve()
    .then(() => window.api.getSystemInfo())
    .then((info) => {
      systemInfo.value = info
    })
    .catch(() => {
      systemInfo.value = null
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
  needsConsent?: boolean
  entrypoint?: string
  workspaceId?: string
  restore?: ChangeSetupDraft
}

const cameFromSetup = ref(false)
const needsConsent = ref(false)
const consentAccepted = ref(false)
const consentNudge = ref(false)
const termsDoc = ref<'eula' | 'tos' | null>(null)

function onConsentToggle(accepted: boolean): void {
  consentAccepted.value = accepted
  if (accepted) consentNudge.value = false
  emit('consent-change', accepted)
}

async function open(opts: OpenOpts = {}): Promise<void> {
  loadGeneration++
  const gen = ++modeGeneration
  instName.value = ''
  workspaceId.value = opts.workspaceId?.trim() || PERSONAL_WORKSPACE_ID
  workspaceInstallMode.value = 'public'
  selectedBuildId.value = ''
  selectedBuildTargetId.value = ''
  cameFromSetup.value = opts.cameFromSetup === true
  needsConsent.value = cameFromSetup.value && opts.needsConsent === true
  consentAccepted.value = false
  consentNudge.value = false
  termsDoc.value = null
  buildImportChoice.value = null
  setupBeforeServer = null
  submittingExisting.value = false
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
  heldFields.value.clear()

  if (!gpuName.value && !gpuDetectionDone) detectedGpu.value = t('newInstall.detectingGpu')
  machineUnsupported.value = false
  unsupportedReason.value = ''
  view.value = cameFromSetup.value ? 'change' : 'summary'
  changeSetupDraft = null
  hardwareValidation = null
  hardwareWarning.value = ''
  resetDiskSpace()
  sourceError.value = ''
  authorizingWorkspace.value = false
  initializing.value = true

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
    if (opts.restore && gen === modeGeneration) {
      instName.value = opts.restore.instName
      await restoreNewInstallSetup(opts.restore)
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

let pendingSignIn: ReturnType<typeof authStore.signIn> | null = null

function signInOnce(): ReturnType<typeof authStore.signIn> {
  pendingSignIn ??= authStore.signIn().finally(() => {
    pendingSignIn = null
  })
  return pendingSignIn
}

async function selectManagedInstallMode(): Promise<void> {
  if (authorizingWorkspace.value || managedBuildMode.value) return
  let authenticatedNow = false
  if (!authStore.isSignedIn) {
    const session = changeSetupSession
    authorizingWorkspace.value = true
    try {
      const status = await signInOnce()
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
  selections.value = {}
  fieldOptions.value.clear()
  fieldLoading.value.clear()
  fieldErrors.value.clear()
  textFieldValues.value.clear()
  heldFields.value.clear()
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

  holdFieldsFrom(source, fieldIndex)
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
    heldFields.value.delete(field.id)

    if (options.length > 0) {
      let defaultIndex = options.findIndex((opt) => opt.recommended)
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
    releaseFieldsFrom(source, fieldIndex)
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
    supersedeFieldLoads(nextSelect)
  } else {
    saveDisabled.value = false
  }
}

function supersedeFieldLoads(fromIndex: number): void {
  loadGeneration++
  void loadFieldOptions(fromIndex)
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
    supersedeFieldLoads(nextSelect)
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

async function handOffInstall(result: InstallBuildResult, failureTitle: string): Promise<void> {
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
      template_selected: false
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
  await handOffInstall(result, t('errors.installFailed'))
}

async function confirmNvidiaDriver(source: Source): Promise<boolean> {
  if (source.id !== 'standalone') return true
  const variantId = selections.value.variant?.data?.variantId as string | undefined
  if (!variantId || !stripVariantPrefix(variantId).startsWith('nvidia')) return true
  return checkNvidiaDriverOrWarn('wizard', 'save', modal.confirm, t)
}

function commitTextFields(source: Source): void {
  for (const f of source.fields) {
    if (f.type === 'text') {
      const value = textFieldValues.value.get(f.id) ?? ''
      selections.value[f.id] = { value, label: value }
    }
  }
}

async function handleSave(): Promise<void> {
  if (managedBuildMode.value) {
    await handleWorkspaceBuildSave()
    return
  }
  const source = currentSource.value
  if (!source || !(await confirmNvidiaDriver(source))) return
  commitTextFields(source)

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
        Array<{ size: number }> | undefined
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

  const result = await window.api.addInstallation({
    name,
    installPath: instPath.value,
    ...instData,
    status: 'installing',
    ...(workspaceId.value ? { workspaceId: workspaceId.value } : {})
  })
  await handOffInstall(result, t('errors.cannotAdd'))
}

function toSelectOptions(options: FieldOption[] | undefined): BaseSelectOption[] {
  return (options ?? []).map((opt) => ({
    value: opt.value,
    label: opt.label,
    description: opt.description
  }))
}

function getSelectOptions(field: SourceField): BaseSelectOption[] {
  return toSelectOptions(fieldOptions.value.get(field.id))
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
  const required = shownInstallSize.value
  if (diskSpaceLoading.value || !diskSpace.value || required <= 0) return ''
  if (diskSpace.value.free >= required) return ''
  return t('newInstall.requiredSpace', { size: formatBytes(required) })
})
const locationMeta = computed(() => {
  const required = shownInstallSize.value
  if (!diskFreeLabel.value || required <= 0 || diskShortLabel.value) return diskFreeLabel.value
  return `${diskFreeLabel.value} · ${t('diskSpace.estimatedRequired', { size: formatBytes(required) })}`
})

let changeSetupDraft: ChangeSetupDraft | null = null

function captureNewInstallSetup(): NewInstallSetup {
  return {
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
}

function openChangeSetup(): void {
  changeSetupDraft = { ...captureNewInstallSetup(), instName: instName.value }
  view.value = 'change'
}

function saveChangeSetup(): void {
  changeSetupDraft = null
  view.value = 'summary'
}

function workspaceBuildPlan(build: Build): SetupPlan {
  const target = selectedBuildTarget.value
  const targetLabel = selectedBuildTargetOptions.value.find(
    (option) => option.value === selectedBuildTargetId.value
  )?.label
  return {
    sourceId: '',
    selections: {},
    installRoot: instPath.value.trim(),
    downloadBytes: build.sizeBytes ?? 0,
    requiredBytes: estimatedInstallSize.value,
    ...(instName.value.trim() ? { name: instName.value.trim() } : {}),
    workspaceBuild: {
      buildId: build.id,
      buildName: build.name,
      ...(target ? { artifactId: target.artifactId, releaseVersion: target.releaseVersion } : {}),
      ...(targetLabel ? { targetLabel } : {})
    }
  }
}

function sourcePlan(source: Source): SetupPlan {
  const picked = rawSelections()
  return {
    sourceId: source.id,
    selections: picked,
    installRoot: instPath.value,
    downloadBytes: downloadBytesOf(picked.variant),
    requiredBytes: estimatedInstallSize.value,
    ...(instName.value.trim() ? { name: instName.value.trim() } : {}),
    ...(workspaceId.value ? { workspaceId: workspaceId.value } : {})
  }
}

const savingSetup = ref(false)

function setupFingerprint(): string {
  return JSON.stringify([
    selectedSourceCard.value,
    instPath.value,
    selectedBuildId.value,
    selectedBuildTargetId.value,
    Object.entries(selections.value).map(([id, option]) => [id, option?.value]),
    [...textFieldValues.value]
  ])
}

async function checkedSetupPlan(): Promise<SetupPlan | null> {
  if (!canProceed.value) return null
  const checked = setupFingerprint()
  const unchanged = () => canProceed.value && setupFingerprint() === checked
  if (!(await validateSelectedInstallRoot()) || !unchanged()) return null
  if (managedBuildMode.value) {
    return selectedBuild.value ? workspaceBuildPlan(selectedBuild.value) : null
  }
  const source = currentSource.value
  if (!source || !(await confirmNvidiaDriver(source)) || !unchanged()) return null
  commitTextFields(source)
  return sourcePlan(source)
}

async function saveSetupForInstall(): Promise<void> {
  if (savingSetup.value) return
  savingSetup.value = true
  try {
    const plan = await checkedSetupPlan()
    if (!plan) return
    resolved.value = true
    emit('save-setup', { plan, draft: { ...captureNewInstallSetup(), instName: instName.value } })
  } finally {
    savingSetup.value = false
  }
}

async function restoreSourceCard(key: string): Promise<void> {
  const tab = installSourceTabs.value.find((candidate) => candidate.key === key)
  if (!tab) return
  if (tab.kind === 'managed') await selectManagedInstallMode()
  else if (managedBuildMode.value) await selectSourceCard(tab.source)
  else resetSourceState(tab.source)
}

async function restoreManagedBuild(buildId: string, targetId: string): Promise<void> {
  if (!workspaceBuilds.value.some((build) => build.id === buildId)) return
  selectedBuildId.value = buildId
  await nextTick()
  if (selectedBuild.value?.releaseTargets?.some((target) => target.artifactId === targetId)) {
    selectedBuildTargetId.value = targetId
  }
}

async function restoreInstallChoice(key: string | null): Promise<void> {
  if (key) {
    await restoreSourceCard(key)
    return
  }
  modeGeneration++
  initializing.value = false
  workspaceInstallMode.value = 'public'
  resetSourceState(null)
}

async function restoreNewInstallSetup(setup: NewInstallSetup): Promise<void> {
  const session = changeSetupSession
  if (setup.sourceKey !== selectedSourceCard.value) await restoreInstallChoice(setup.sourceKey)
  if (session !== changeSetupSession || setup.sourceKey !== selectedSourceCard.value) return
  instPath.value = setup.instPath
  if (managedBuildMode.value) {
    await restoreManagedBuild(setup.selectedBuildId, setup.selectedBuildTargetId)
    return
  }
  loadGeneration++
  heldFields.value.clear()
  selections.value = { ...setup.selections }
  fieldOptions.value = new Map(setup.fieldOptions)
  fieldLoading.value = new Map(setup.fieldLoading)
  fieldErrors.value = new Map(setup.fieldErrors)
  textFieldValues.value = new Map(setup.textFieldValues)
  saveDisabled.value = setup.saveDisabled
  sourceError.value = setup.sourceError
  const interruptedLoad =
    currentSource.value?.fields.findIndex((field) => setup.fieldLoading.get(field.id)) ?? -1
  if (interruptedLoad >= 0) await loadFieldOptions(interruptedLoad)
}

async function discardChangeSetup(): Promise<void> {
  if (submittingExisting.value) return
  changeSetupSession++
  const draft = changeSetupDraft
  changeSetupDraft = null
  view.value = 'summary'
  buildImportChoice.value = null
  setupBeforeServer = null
  authorizingWorkspace.value = false
  if (!draft) return
  instName.value = draft.instName
  await restoreNewInstallSetup(draft)
}

function isHiddenWhenEmpty(field: SourceField): boolean {
  const held = heldFields.value.get(field.id)
  if (held) return held.hidden
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
const systemMachineName = computed(() =>
  machineName(systemInfo.value, isCpuVariant(selections.value.variant))
)
const machineTitle = computed(() =>
  machineBlocked.value
    ? unsupportedReason.value
    : systemMachineName.value || gpuName.value || detectedGpu.value
)
const machineDetected = computed(
  () => !machineBlocked.value && !!(systemMachineName.value || gpuName.value)
)
const machineMemoryGb = computed(() =>
  systemInfo.value?.total_memory_gb ? Math.round(systemInfo.value.total_memory_gb) : null
)
const buildCatalogFailed = computed(() => managedBuildMode.value && authStore.buildsError)
const blockingFieldError = computed(
  () => urlFieldError.value || fieldErrors.value.values().next().value || ''
)

const SOURCE_ICONS: Record<string, Component> = {
  standalone: Package,
  portable: FolderArchive,
  remote: Globe
}

function sourceCardLabel(source: Source): string {
  if (source.id === 'standalone') return t('newInstall.publicBuilds')
  if (source.id === 'remote') return t('newInstall.onServer')
  return source.label
}

function sourceCardDescription(source: Source): string | undefined {
  if (source.id === 'standalone') return t('newInstall.publicBuildsMeta')
  if (source.id === 'remote') return t('newInstall.onServerMeta')
  return source.description
}

function toSourceCard(tab: InstallSourceTab): SetupOptionCard {
  if (tab.kind === 'managed') {
    return {
      value: tab.key,
      label: t('newInstall.managedBuilds'),
      description: t('newInstall.managedBuildsMeta'),
      icon: Users,
      testId: 'workspace-install-source-managed',
      disabled: choiceLocked.value
    }
  }
  return {
    value: tab.key,
    label: sourceCardLabel(tab.source),
    description: sourceCardDescription(tab.source),
    icon: SOURCE_ICONS[tab.source.id] ?? Package,
    testId: `install-source-${tab.source.id}`,
    disabled: choiceLocked.value
  }
}

const sourceCards = computed<SetupOptionCard[]>(() => newInstallTabs.value.map(toSourceCard))
const sourceSelectOptions = computed<BaseSelectOption[]>(() =>
  sourceCards.value.map(toCardSelectOption)
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

type BuildImportFlow = 'track' | 'load-snapshot'
type StartFrom = 'new' | 'existing'

const BUILD_IMPORT_TELEMETRY: Record<BuildImportFlow, string> = {
  track: 'track_existing',
  'load-snapshot': 'load_snapshot'
}

const buildImportChoice = ref<BuildImportFlow | null>(null)
const submittingExisting = ref(false)
let setupBeforeServer: NewInstallSetup | null = null

const usesExistingServer = computed(
  () => localInstallMode.value && currentSource.value?.skipInstall === true
)

const startFrom = computed<StartFrom>(() =>
  buildImportChoice.value || usesExistingServer.value ? 'existing' : 'new'
)

const choiceLocked = computed(() => authorizingWorkspace.value || submittingExisting.value)
const startFromLocked = computed(() => choiceLocked.value || !setupPicked.value)
const showsHardwareWarning = computed(() => !!hardwareWarning.value && startFrom.value === 'new')

const startFromOptions = computed<{ value: StartFrom; label: string; testId: string }[]>(() => [
  { value: 'new', label: t('newInstall.startFromNew'), testId: 'config-start-from-new' },
  {
    value: 'existing',
    label: t(
      offersBuildImport.value ? 'newInstall.startFromExisting' : 'newInstall.startFromServer'
    ),
    testId: 'config-start-from-existing'
  }
])

const existingCards = computed<SetupOptionCard[]>(() => {
  const serverCards = existingComfyTabs.value.map(toSourceCard)
  if (!offersBuildImport.value) return serverCards
  return [
    {
      value: 'track' satisfies BuildImportFlow,
      label: t('newInstall.onThisComputer'),
      description: t('newInstall.onThisComputerMeta'),
      icon: Monitor,
      testId: 'existing-comfy-folder',
      disabled: choiceLocked.value
    },
    ...serverCards,
    {
      value: 'load-snapshot' satisfies BuildImportFlow,
      label: t('newInstall.inSnapshotFile'),
      description: t('newInstall.inSnapshotFileMeta'),
      icon: FileArchive,
      testId: 'existing-comfy-snapshot',
      disabled: choiceLocked.value
    }
  ]
})

const selectedExistingCard = computed(() => buildImportChoice.value ?? selectedSourceCard.value)

function chooseBuildImport(flow: BuildImportFlow): void {
  if (buildImportChoice.value === flow) return
  buildImportChoice.value = flow
  emitTelemetryAction('comfy.desktop.install.flow.opened', {
    flow: BUILD_IMPORT_TELEMETRY[flow],
    entrypoint: 'new-install'
  })
}

async function selectExistingCard(key: string): Promise<void> {
  if (key === 'track' || key === 'load-snapshot') {
    chooseBuildImport(key)
    return
  }
  if (!usesExistingServer.value) setupBeforeServer = captureNewInstallSetup()
  await selectSourceCardByKey(key)
  if (usesExistingServer.value) buildImportChoice.value = null
}

async function selectStartFrom(next: StartFrom): Promise<void> {
  if (startFromLocked.value || next === startFrom.value) return
  if (next === 'existing') {
    const first = existingCards.value[0]
    if (first) await selectExistingCard(first.value)
    return
  }
  buildImportChoice.value = null
  if (!usesExistingServer.value) return
  if (!setupBeforeServer) {
    await restoreInstallChoice(null)
    return
  }
  await restoreNewInstallSetup(setupBeforeServer)
  if (!usesExistingServer.value) setupBeforeServer = null
}

function selectCardOptionByValue(field: SourceField, fieldIndex: number, value: string): void {
  const option = fieldOptions.value.get(field.id)?.find((candidate) => candidate.value === value)
  if (option) selectCardOption(field, fieldIndex, option)
}

function toCardSelectOption(card: SetupOptionCard): BaseSelectOption {
  return {
    value: card.value,
    label: card.label,
    description: card.description,
    disabled: card.disabled,
    icon: card.icon,
    testId: card.testId,
    badge: card.recommended ? t('newInstall.recommended') : undefined
  }
}

function hardwareSelectOptions(field: SourceField): BaseSelectOption[] {
  const options = sortedCardOptions(shownOptions(field) ?? [])
  const cards = field.id === HARDWARE_FIELD_ID ? toHardwareCards(options) : toOptionCards(options)
  return cards.map(toCardSelectOption)
}

const buildTargetOptions = computed(() =>
  toHardwareCards(selectedBuildTargetOptions.value).map(toCardSelectOption)
)

const FIELD_ICONS: Record<string, Component> = {
  variant: Zap,
  release: Package,
  comfyVersion: Package,
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

const trackFormRef = ref<InstanceType<typeof TrackBuildForm> | null>(null)
const snapshotFormRef = ref<InstanceType<typeof LoadSnapshotForm> | null>(null)

const primaryLabel = computed(() => {
  if (buildImportChoice.value === 'track') return t('track.trackInstallation')
  if (buildImportChoice.value === 'load-snapshot') {
    return snapshotFormRef.value?.creating
      ? `${t('newInstall.installing')}…`
      : t('list.snapshotCreateInstall')
  }
  if (usesExistingServer.value) return t('newInstall.connect')
  return t('newInstall.install')
})

const canProceed = computed(() => {
  if (submittingExisting.value) return false
  if (buildImportChoice.value === 'track') return trackFormRef.value?.canSave ?? false
  if (buildImportChoice.value === 'load-snapshot') return snapshotFormRef.value?.canCreate ?? false
  return canContinue.value
})

async function useExistingComfy(): Promise<void> {
  if (submittingExisting.value) return
  submittingExisting.value = true
  try {
    if (buildImportChoice.value === 'track') await trackFormRef.value?.save()
    else if (buildImportChoice.value === 'load-snapshot') await snapshotFormRef.value?.create()
    else await handleSave()
  } finally {
    submittingExisting.value = false
  }
}

const useTakeoverHost = computed(() => props.hideBackToDashboard)
const modalTitle = computed(() =>
  t(view.value === 'change' ? 'newInstall.changeSetupTitle' : 'newInstall.newBuildTitle')
)
const modalLead = computed(() => {
  if (view.value !== 'change') return t('chooser.newInstallDesc')
  return t(
    startFrom.value === 'existing' ? 'newInstall.existingComfyLead' : 'newInstall.changeSetupLead'
  )
})
const ariaLabel = computed(() => t('newInstall.newBuildTitle'))

function discardChanges(): void {
  if (savingSetup.value) return
  if (cameFromSetup.value) handleBackToSetup()
  else void discardChangeSetup()
}

function saveChanges(): void {
  if (cameFromSetup.value) void saveSetupForInstall()
  else saveChangeSetup()
}

function handOffImportedBuild(): void {
  resolved.value = true
  emit('navigate-list')
}

function handOffSnapshotInstall(opts: ShowProgressOpts): void {
  resolved.value = true
  emit('show-progress', opts)
}

defineExpose({ open })
</script>

<template>
  <SetupModal
    :dialog-label="ariaLabel"
    :title="modalTitle"
    :lead="modalLead"
    :anchor-top="view === 'change'"
    :brand-backdrop="useTakeoverHost"
    :closable="view === 'summary' && !hideBackToDashboard"
    :close-title="$t('common.backToDashboard')"
    data-testid="new-build-modal"
    @close="emit('close')"
  >
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
      v-if="sourceError && !buildImportChoice"
      class="config-error mt-4 text-[13px] leading-[1.4] text-[var(--danger)]"
      role="alert"
    >
      {{ sourceError }}
    </div>

    <div v-if="view === 'summary'" class="config-summary" data-testid="config-summary">
      <div
        class="config-name-card mt-4 grid grid-cols-[132px_minmax(0,1fr)] items-center gap-x-4 rounded-[14px] bg-white/5 px-4 py-3"
      >
        <label
          class="config-label flex items-center gap-2.5 text-[13px] leading-5 text-text-muted"
          for="inst-name-standalone"
          ><Tag :size="15" aria-hidden="true" />{{ $t('common.name') }}</label
        >
        <InstallNameInput
          v-model="instName"
          :placeholder="suggestedName || $t('common.namePlaceholder')"
          :error="nameError"
          :initial-focus="hideBackToDashboard"
        />
      </div>

      <div
        class="config-machine relative mt-3 flex items-center gap-7 overflow-hidden rounded-[14px] px-7 py-6 [background:radial-gradient(ellipse_70%_120%_at_12%_0%,rgb(255_255_255/0.09),transparent_70%),rgb(255_255_255/0.04)]"
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
          <span
            v-if="machineMemoryGb && !machineBlocked"
            class="config-machine-memory mt-[3px] text-[13px] leading-4 text-text-muted"
            data-testid="detected-machine-memory"
            >{{ $t('setup.memory', { gb: machineMemoryGb }) }}</span
          >
        </span>
        <Button
          size="md"
          variant="secondary"
          type="button"
          class="config-change ml-auto flex-none px-3"
          data-testid="config-change-setup"
          :disabled="!setupPicked"
          @click="openChangeSetup"
        >
          {{ $t('newInstall.change') }}
        </Button>
      </div>
      <div
        v-if="showsHardwareWarning"
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
      <div v-if="buildCatalogFailed" class="mt-2 flex px-1" role="alert">
        <Button
          size="unset"
          variant="destructive-textonly"
          type="button"
          class="wizard-build-retry text-left text-[12px] leading-[1.4] whitespace-normal"
          data-testid="config-summary-build-retry"
          :disabled="authStore.loadingBuilds || authorizingWorkspace"
          @click="refreshManagedBuilds"
        >
          {{ $t('devPlatform.build.loadError') }}
        </Button>
      </div>

      <dl
        class="config-summary-list m-0 mt-3 flex flex-col"
        :aria-label="$t('newInstall.installSummary')"
      >
        <SetupSummaryRow
          v-for="row in summaryRows"
          :key="row.key"
          :icon="row.icon"
          :label="row.label"
        >
          <span class="grid min-w-0 flex-1 gap-1">
            <span class="truncate text-[13px] leading-5 text-neutral-100">{{ row.value }}</span>
            <span v-if="row.meta" class="truncate text-[12px] leading-4 text-text-muted">{{
              row.meta
            }}</span>
          </span>
        </SetupSummaryRow>
        <SetupSummaryRow
          v-if="showLocation"
          class="config-summary-location"
          :icon="HardDrive"
          :label="$t('common.location')"
        >
          <div class="grid min-w-0 flex-1 gap-1" data-testid="config-summary-path">
            <PathOpenButton
              v-if="instPath"
              class="leading-5"
              :path="instPath"
              @open="handleOpenInstPath"
            />
            <span v-if="locationMeta" class="truncate text-[12px] leading-4 text-text-muted">{{
              locationMeta
            }}</span>
            <span
              v-if="diskShortLabel"
              class="config-path-required text-[12px] leading-4 text-[var(--warning)]"
              >{{ diskShortLabel }}</span
            >
            <PathDiskInfo
              issues-only
              :path-issues="pathIssues"
              :disk-space-loading="diskSpaceLoading"
              :disk-space="diskSpace"
              :estimated-size="estimatedInstallSize"
            />
          </div>
          <Button
            variant="textonly"
            type="button"
            class="config-path-browse flex-none px-3 text-neutral-100 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.16)] hover:bg-white/6"
            data-testid="config-summary-browse"
            @click="handleBrowse"
          >
            {{ $t('common.browse') }}
          </Button>
        </SetupSummaryRow>
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
      class="config-change-form mt-3 flex flex-col [&_.setup-form-row]:py-1.5"
      data-testid="config-change-form"
    >
      <div v-if="existingCards.length > 0" class="config-start-from flex pt-1 pb-2">
        <SegmentedControl
          data-testid="config-start-from"
          :model-value="startFrom"
          :options="startFromOptions"
          :label="$t('newInstall.startFrom')"
          :disabled="startFromLocked"
          @update:model-value="selectStartFrom"
        />
      </div>

      <SetupFormRow
        v-if="!buildImportChoice && (cameFromSetup || startFrom === 'existing')"
        class="config-name-row"
        :label="$t('common.name')"
        label-for="inst-name-standalone"
        :icon="Tag"
      >
        <InstallNameInput
          v-model="instName"
          :placeholder="suggestedName || $t('common.namePlaceholder')"
          :error="nameError"
        />
      </SetupFormRow>

      <div
        v-if="showsHardwareWarning"
        class="config-hardware-warning px-1 pb-2 text-[12px] leading-[1.4] text-[var(--warning)]"
        role="alert"
        data-testid="wizard-hardware-warning"
      >
        {{ hardwareWarning }}
      </div>

      <SetupFormRow
        v-if="startFrom === 'new' && sources.length > 0"
        :label="$t('newInstall.getComfyFrom')"
        :icon="Download"
      >
        <BaseSelect
          class="config-method-row text-[13px]"
          data-testid="install-source-tabs"
          :model-value="selectedSourceCard ?? ''"
          :options="sourceSelectOptions"
          :disabled="choiceLocked"
          :aria-label="$t('newInstall.chooseMethod')"
          @update:model-value="selectSourceCardByKey"
        />
      </SetupFormRow>

      <SetupFormRow
        v-if="startFrom === 'existing' && existingCards.length > 1"
        class="config-existing-comfy"
        :label="$t('newInstall.whereItIs')"
        :icon="MapPin"
        control-height="cards"
      >
        <SetupOptionCards
          data-testid="existing-comfy-tabs"
          layout="grid"
          activation="manual"
          :aria-label="$t('newInstall.whereItIs')"
          :options="existingCards"
          :selected-value="selectedExistingCard"
          @select="selectExistingCard"
        />
      </SetupFormRow>

      <KeepAlive>
        <TrackBuildForm
          v-if="buildImportChoice === 'track'"
          ref="trackFormRef"
          v-model:name="instName"
          data-testid="existing-comfy-folder-form"
          @saved="handOffImportedBuild"
        />
        <LoadSnapshotForm
          v-else-if="buildImportChoice === 'load-snapshot'"
          ref="snapshotFormRef"
          data-testid="existing-comfy-snapshot-form"
          @created="handOffSnapshotInstall"
        />
      </KeepAlive>
      <template v-if="!buildImportChoice">
        <template v-if="managedBuildMode">
          <SetupFormRow
            :label="$t('newInstall.workspaceBuildLabel')"
            :icon="Users"
            data-testid="workspace-build-field"
          >
            <div class="flex min-w-0 flex-col gap-2">
              <BaseSelect
                v-model="selectedBuildId"
                class="text-[13px]"
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
              <Button
                v-if="authStore.buildsError"
                size="unset"
                variant="destructive-textonly"
                type="button"
                class="wizard-build-retry self-start text-left text-[13px] whitespace-normal"
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
          </SetupFormRow>

          <SetupFormRow
            v-if="selectedBuildTargetOptions.length > 0"
            :label="$t('newInstall.buildTarget')"
            :icon="Zap"
            data-testid="workspace-build-targets"
          >
            <BaseSelect
              v-model="selectedBuildTargetId"
              class="text-[13px]"
              :options="buildTargetOptions"
              :aria-label="$t('newInstall.buildTarget')"
            />
          </SetupFormRow>
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
            <SetupFormRow
              v-show="!isHiddenWhenEmpty(field) && !isInlinedField(field)"
              class="config-source-field"
              :label="field.label"
              :label-for="`sf-${field.id}`"
              :icon="FIELD_ICONS[field.id] ?? SlidersHorizontal"
              :control-height="field.type === 'text' ? 'centered' : 'field'"
            >
              <div v-if="field.type === 'text'" class="flex min-w-0 flex-col">
                <div class="config-text-action flex items-stretch gap-2">
                  <InputGroup
                    class="config-input config-source-text min-w-0 flex-auto"
                    :class="{ 'config-input--invalid': field.id === 'url' && urlFieldError }"
                  >
                    <InputGroupInput
                      :id="`sf-${field.id}`"
                      class="text-[13px] text-neutral-100"
                      type="text"
                      :model-value="textFieldValues.get(field.id) ?? ''"
                      :placeholder="field.defaultValue || ''"
                      :aria-invalid="field.id === 'url' && !!urlFieldError"
                      :aria-describedby="
                        field.id === 'url' && urlFieldError ? `sf-${field.id}-error` : undefined
                      "
                      @input="
                        textFieldValues.set(field.id, ($event.target as HTMLInputElement).value)
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
                <BaseSelect
                  v-if="shownOptions(field)?.length"
                  class="config-card-select text-[13px]"
                  :data-testid="`config-select-${field.id}`"
                  :model-value="shownSelections[field.id]?.value ?? ''"
                  :options="hardwareSelectOptions(field)"
                  :loading="isRefreshing(field)"
                  :aria-label="field.label"
                  @update:model-value="(value) => selectCardOptionByValue(field, fieldIndex, value)"
                />
                <div
                  v-else-if="fieldLoading.get(field.id)"
                  class="config-loading py-2.5 text-[13px] text-text-muted"
                  :class="spinnerClass"
                >
                  {{ $t('newInstall.loading') }}
                </div>
                <div
                  v-else-if="shownOptions(field)"
                  class="config-loading py-2.5 text-[13px] text-text-muted"
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
                  :model-value="shownSelections[inlineVersionField.id]?.value ?? ''"
                  :options="toSelectOptions(shownOptions(inlineVersionField))"
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
                class="text-[13px]"
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
            </SetupFormRow>
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
      </template>
    </div>

    <template #footer>
      <template v-if="view === 'change'">
        <TermsConsentRow
          v-if="needsConsent && startFrom === 'existing'"
          class="config-consent mr-2 min-w-0"
          id-prefix="config"
          :accepted="consentAccepted"
          :nudge="consentNudge"
          :hint="$t('newInstall.agreeToContinue')"
          @update:accepted="onConsentToggle"
          @open-terms="termsDoc = $event"
        />
        <span class="flex-1" />
        <Button
          size="lg"
          variant="secondary"
          type="button"
          class="h-9 rounded-[10px] config-discard-changes"
          data-testid="config-discard-changes"
          :disabled="submittingExisting || savingSetup"
          @click="discardChanges"
        >
          {{ $t('newInstall.discardChanges') }}
        </Button>
        <Button
          v-if="startFrom === 'existing'"
          type="button"
          size="lg"
          variant="inverted"
          class="h-9 rounded-[10px] config-use-existing min-w-[104px]"
          data-testid="config-use-existing"
          :disabled="!canProceed"
          @click="handleConfigureContinue"
        >
          {{ primaryLabel }}
        </Button>
        <Button
          v-else
          type="button"
          size="lg"
          variant="inverted"
          class="h-9 rounded-[10px] config-save-changes min-w-[104px]"
          data-testid="config-save-changes"
          :disabled="cameFromSetup && (!canProceed || savingSetup)"
          @click="saveChanges"
        >
          {{ $t('newInstall.saveChanges') }}
        </Button>
      </template>
      <template v-else>
        <span class="flex-1" />
        <Button
          type="button"
          size="lg"
          variant="inverted"
          class="h-9 rounded-[10px] config-continue min-w-[104px]"
          :disabled="!canProceed"
          @click="handleConfigureContinue"
        >
          {{ primaryLabel }}
        </Button>
      </template>
    </template>
  </SetupModal>
  <TermsModal v-if="termsDoc" :open="true" :doc="termsDoc" @close="termsDoc = null" />
</template>
