<script setup lang="ts">
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import { ref, computed, nextTick, onMounted, onUnmounted, useId, watch } from 'vue'
import { Check, Copy, FolderInput, Info, Loader2 } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import TakeoverHeader from '../components/TakeoverHeader.vue'
import ModalShell from '../components/ModalShell.vue'
import ChoiceCard from '../components/ChoiceCard.vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import TermsModal from '../components/TermsModal.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import InlineRichText from '../components/InlineRichText.vue'
import { emitTelemetryAction } from '../lib/telemetry'
import type { GpuTier } from '../../../shared/gpuTier'
import type { CloudUserTier, SystemInfo } from '../../../types/ipc'

const legalLinkClass = 'inline h-auto whitespace-normal p-0 text-inherit underline [font:inherit]'
const modifierClass =
  'inline-flex cursor-pointer items-start gap-2 text-[13px] text-neutral-300 transition-[opacity,transform] duration-180 ease-out motion-reduce:transition-none'
const consentClass =
  'flex cursor-pointer items-center gap-2.5 text-[13px] leading-[1.5] text-neutral-200'
const branchCardClass = 'h-auto w-full justify-start gap-3 whitespace-normal p-4 text-left'

type Step = 'start' | 'mirrors' | 'localBranch'

const emit = defineEmits<{
  'complete-cloud': []
  'complete-skip': []
  'chain-local': [payload?: { cameFromLocalBranch?: boolean; express?: boolean }]
  'chain-migrate': [{ express: boolean }]
}>()

const step = ref<Step>('start')
const telemetryEnabled = ref(true)
const betaFeaturesEnabled = ref(true)
const betaTouched = ref(false)
const preservePersistedBetaOptIn = ref(false)
const betaBlocked = computed(() => !telemetryEnabled.value && !betaFeaturesEnabled.value)
const betaBlockedReasonId = useId()
const locale = ref('en')

const FORK_DEFAULT_EXPERIMENT_KEY = 'desktop-first-use-fork-default'
type ForkVariant = 'control' | 'cloud-default' | 'no-default'
const forkExperimentVariant = ref<ForkVariant | null>(null)

const pickedChoice = ref<'cloud' | 'local' | null>('local')
const userHasPicked = ref(false)

const initialDefaultChoice = ref<'cloud' | 'local' | null>('local')

function mapFlagToVariant(flagValue: string | boolean | null | undefined): ForkVariant {
  if (flagValue === 'cloud') return 'cloud-default'
  if (flagValue === 'none') return 'no-default'
  return 'control'
}
let forkExposureSource: 'cache' | 'fallback' | null = null
async function loadForkExperimentVariant(): Promise<ForkVariant> {
  let flagValue: string | boolean | null | undefined
  try {
    flagValue = await window.api.telemetryGetExperimentFlag(FORK_DEFAULT_EXPERIMENT_KEY)
  } catch {
    flagValue = undefined
  }
  forkExposureSource = typeof flagValue === 'string' ? 'cache' : 'fallback'
  return mapFlagToVariant(flagValue)
}

let forkExposureRecorded = false
function maybeRecordForkExposure(): void {
  if (forkExposureRecorded) return
  const variant = forkExperimentVariant.value
  if (!variant || !forkExposureSource) return
  if (!hardwareChecked.value) return
  forkExposureRecorded = true
  if (hardwareRecommendsCloud.value) return
  try {
    window.api.telemetryRecordExposure({
      experimentKey: FORK_DEFAULT_EXPERIMENT_KEY,
      variant,
      source: forkExposureSource
    })
  } catch {}
}

async function loadCloudFreeRunsEnabled(): Promise<boolean> {
  try {
    return await window.api.getCloudFreeRunsEnabled()
  } catch {
    return false
  }
}

async function loadCloudUserTier(): Promise<CloudUserTier> {
  try {
    return await window.api.getCloudUserTier()
  } catch {
    return 'unknown'
  }
}

function applyForkExperimentDefault(variant: ForkVariant): void {
  if (hasLegacyDesktop.value) {
    pickedChoice.value = 'local'
    initialDefaultChoice.value = 'local'
    return
  }
  if (userHasPicked.value) return

  if (variant === 'cloud-default') {
    pickedChoice.value = 'cloud'
    initialDefaultChoice.value = 'cloud'
  } else if (variant === 'no-default') {
    pickedChoice.value = null
    initialDefaultChoice.value = null
  } else {
    pickedChoice.value = 'local'
    initialDefaultChoice.value = 'local'
  }
  if (hardwareRecommendsCloud.value) {
    pickedChoice.value = null
    initialDefaultChoice.value = null
  }
}

onMounted(async () => {
  const [variant, freeRunsEnabled, userTier] = await Promise.all([
    loadForkExperimentVariant(),
    loadCloudFreeRunsEnabled(),
    loadCloudUserTier()
  ])
  forkExperimentVariant.value = variant
  cloudFreeRunsEnabled.value = freeRunsEnabled
  cloudUserTier.value = userTier
  applyForkExperimentDefault(variant)
})
const expressInstall = ref(false)
const migrateExisting = ref(true)
const showMigrateExisting = computed(() => pickedChoice.value === 'local' && hasLegacyDesktop.value)
const detectedGpuLabel = ref<string | null>(null)
const showGpuHint = computed(
  () => pickedChoice.value === 'local' && expressInstall.value && detectedGpuLabel.value !== null
)
const hardwareWarning = ref('')
const showHardwareWarning = computed(
  () => pickedChoice.value === 'local' && hardwareWarning.value !== ''
)
let openGeneration = 0
const gpuTier = ref<GpuTier | null>(null)
const gpuVendor = ref<string | null>(null)
const gpuVramGb = ref<number | null>(null)
const hardwareChecked = ref(false)
let systemInfoPromise: Promise<SystemInfo | null> | null = null
function loadSystemInfo(): Promise<SystemInfo | null> {
  systemInfoPromise ??= (async () => {
    try {
      return await window.api.getSystemInfo()
    } catch {
      return null
    }
  })()
  return systemInfoPromise
}
const RECO_GPU_TIERS: ReadonlySet<GpuTier> = new Set<GpuTier>(['sub_low', 'cpu_only'])
const CLOUD_RECO_REASON_ID = 'first-use-cloud-reco-reason'
const cloudFreeRunsEnabled = ref(false)
const cloudUserTier = ref<CloudUserTier>('unknown')
const vramUnverified = computed(
  () => (gpuVendor.value === 'nvidia' || gpuVendor.value === 'amd') && gpuVramGb.value === null
)
const hardwareRecommendsCloud = computed(
  () =>
    hardwareChecked.value &&
    gpuTier.value !== null &&
    RECO_GPU_TIERS.has(gpuTier.value) &&
    !vramUnverified.value
)
watch(hardwareRecommendsCloud, (recommends) => {
  if (recommends && !userHasPicked.value && !hasLegacyDesktop.value) {
    pickedChoice.value = null
    initialDefaultChoice.value = null
  }
})
watch([hardwareChecked, forkExperimentVariant], () => {
  maybeRecordForkExposure()
})
let mountedAt = Date.now()
const stepsSeen = new Set<Step>()
let completedFired = false
let chainHandoff = false

function emitCompleted(exitPath: 'cloud' | 'local-new' | 'local-migrate' | 'skipped'): void {
  chainHandoff = exitPath === 'local-new' || exitPath === 'local-migrate'
  if (completedFired) return
  completedFired = true
  const durationMs = Date.now() - mountedAt
  emitTelemetryAction('comfy.desktop.first_use.completed', {
    exit_path: exitPath,
    steps_seen: stepsSeen.size,
    duration_ms: durationMs,
    duration_seconds: Math.round(durationMs / 1000),
    had_legacy: hasLegacyDesktop.value,
    had_existing_install: skipPick.value,
    experiment_key: FORK_DEFAULT_EXPERIMENT_KEY,
    experiment_variant: forkExperimentVariant.value,
    reco_shown: hardwareRecommendsCloud.value,
    gpu_tier: gpuTier.value
  })
}
const skipPick = ref(false)
const hasLegacyDesktop = ref(false)
const whyCloudOpen = ref(false)
const termsDoc = ref<'eula' | 'tos' | 'privacy' | 'notices' | null>(null)
const acceptedTos = ref(false)
const isContinuing = ref(false)
const tosNudge = ref(false)
let nudgeTimer: ReturnType<typeof setTimeout> | undefined

const isChinese = computed(() => locale.value.startsWith('zh'))

const isBrandStep = computed(() => step.value === 'start' || step.value === 'localBranch')

function applyBetaEntryRule(): void {
  if (!telemetryEnabled.value) {
    if (!preservePersistedBetaOptIn.value) betaFeaturesEnabled.value = false
    return
  }
  if (!betaTouched.value) betaFeaturesEnabled.value = true
}

watch(telemetryEnabled, applyBetaEntryRule)

function onBetaFeaturesToggle(value: boolean | 'indeterminate'): void {
  const next = value === true
  if (!telemetryEnabled.value && next) return
  preservePersistedBetaOptIn.value = false
  betaTouched.value = true
  betaFeaturesEnabled.value = next
}

function nudgeTos(): void {
  if (acceptedTos.value) return
  tosNudge.value = true
  clearTimeout(nudgeTimer)
  nudgeTimer = setTimeout(() => {
    tosNudge.value = false
  }, 600)
}

async function onContinue(): Promise<void> {
  if (isContinuing.value) return
  if (!acceptedTos.value) {
    nudgeTos()
    return
  }
  if (pickedChoice.value === null) return
  isContinuing.value = true

  await window.api.setSetting('telemetryEnabled', telemetryEnabled.value)
  await window.api.setSetting('betaFeaturesEnabled', betaFeaturesEnabled.value)

  emitTelemetryAction('comfy.desktop.first_use.consent_decision', {
    decision: telemetryEnabled.value ? 'accept' : 'decline',
    telemetry_enabled: telemetryEnabled.value,
    locale: locale.value
  })
  emitTelemetryAction('comfy.desktop.first_use.fork_chosen', {
    choice: pickedChoice.value,
    has_legacy_desktop: hasLegacyDesktop.value,
    express_install: expressInstall.value,
    was_default: pickedChoice.value === initialDefaultChoice.value,
    user_tier: cloudUserTier.value,
    experiment_key: FORK_DEFAULT_EXPERIMENT_KEY,
    experiment_variant: forkExperimentVariant.value,
    reco_shown: hardwareRecommendsCloud.value,
    gpu_tier: gpuTier.value
  })

  if (isChinese.value) {
    step.value = 'mirrors'
    isContinuing.value = false
    return
  }

  void routePostStart()
}

async function routePostStart(): Promise<void> {
  if (skipPick.value) {
    emitCompleted('skipped')
    emit('complete-skip')
    return
  }
  if (pickedChoice.value === 'cloud') {
    emitCompleted('cloud')
    emit('complete-cloud')
  } else if (hasLegacyDesktop.value && migrateExisting.value) {
    emitTelemetryAction('comfy.desktop.first_use.local_branch_chosen', { choice: 'migrate' })
    emitCompleted('local-migrate')
    emit('chain-migrate', { express: expressInstall.value })
  } else if (hasLegacyDesktop.value && !expressInstall.value) {
    step.value = 'localBranch'
    isContinuing.value = false
  } else {
    emitCompleted('local-new')
    emit('chain-local', { express: expressInstall.value })
  }
}

async function chooseMirrors(useMirrors: boolean): Promise<void> {
  await Promise.all([
    window.api.setSetting('useChineseMirrors', useMirrors),
    window.api.setSetting('chineseMirrorsPrompted', true)
  ])
  emitTelemetryAction('comfy.desktop.first_use.mirrors_chosen', { use_mirrors: useMirrors })
  void routePostStart()
}

function openWhyCloud(): void {
  whyCloudOpen.value = true
  emitTelemetryAction('comfy.desktop.first_use.why_cloud_opened', {})
}

function dismissWhyCloud(action: 'maybe_later' | 'dismiss'): void {
  whyCloudOpen.value = false
  emitTelemetryAction('comfy.desktop.first_use.why_cloud_action', { action })
}

function onWhyCloudTryCloud(): void {
  whyCloudOpen.value = false
  emitTelemetryAction('comfy.desktop.first_use.why_cloud_action', { action: 'try_cloud' })
  pickChoice('cloud')
}

function chooseMigrate(): void {
  emitTelemetryAction('comfy.desktop.first_use.local_branch_chosen', { choice: 'migrate' })
  emitCompleted('local-migrate')
  emit('chain-migrate', { express: false })
}

function pickChoice(choice: 'cloud' | 'local'): void {
  userHasPicked.value = true
  pickedChoice.value = choice
}

function onStartCardsKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (!target?.closest('[role="radio"]')) return
  const order = ['cloud', 'local'] as const
  const currentIndex = pickedChoice.value === null ? -1 : order.indexOf(pickedChoice.value)
  const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
  const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
  if (!forward && !backward) return
  const next =
    currentIndex < 0
      ? forward
        ? 0
        : order.length - 1
      : (currentIndex + (forward ? 1 : -1) + order.length) % order.length
  const nextChoice = order[next]
  if (!nextChoice) return
  e.preventDefault()
  pickChoice(nextChoice)
  const group = e.currentTarget as HTMLElement | null
  void nextTick(() => {
    const radios = group?.querySelectorAll<HTMLElement>('[role="radio"]')
    radios?.[next]?.focus()
  })
}

function chooseInstallNew(): void {
  emitTelemetryAction('comfy.desktop.first_use.local_branch_chosen', { choice: 'install_new' })
  emitCompleted('local-new')
  emit('chain-local', { cameFromLocalBranch: true })
}

interface OpenOpts {
  skipPick?: boolean
  hasLegacyDesktop?: boolean
  initialStep?: 'start' | 'localBranch'
}

async function open(opts: OpenOpts = {}): Promise<void> {
  step.value = opts.initialStep ?? 'start'
  skipPick.value = opts.skipPick === true
  hasLegacyDesktop.value = opts.hasLegacyDesktop === true
  whyCloudOpen.value = false
  termsDoc.value = null
  acceptedTos.value = false
  pickedChoice.value = 'local'
  initialDefaultChoice.value = 'local'
  userHasPicked.value = false
  if (forkExperimentVariant.value) {
    applyForkExperimentDefault(forkExperimentVariant.value)
  }
  expressInstall.value = false
  migrateExisting.value = true
  isContinuing.value = false
  mountedAt = Date.now()
  stepsSeen.clear()
  stepsSeen.add(step.value)
  completedFired = false
  chainHandoff = false
  const [existing, existingBeta] = (await Promise.all([
    window.api.getSetting('telemetryEnabled'),
    window.api.getSetting('betaFeaturesEnabled')
  ])) as [boolean | undefined, boolean | undefined]
  telemetryEnabled.value = existing !== false
  betaTouched.value = typeof existingBeta === 'boolean'
  preservePersistedBetaOptIn.value = existingBeta === true
  betaFeaturesEnabled.value = betaTouched.value ? existingBeta === true : telemetryEnabled.value
  applyBetaEntryRule()
  const gen = ++openGeneration
  detectedGpuLabel.value = null
  hardwareWarning.value = ''
  void window.api
    .getLocale()
    .then((next) => {
      locale.value = next
    })
    .catch(() => {})
  hardwareChecked.value = false
  void loadSystemInfo()
    .then((info) => {
      detectedGpuLabel.value = info?.gpu_label ?? null
      gpuTier.value = info?.gpu_tier ?? null
      gpuVendor.value = info?.gpu_vendor ?? null
      gpuVramGb.value = info?.gpu_vram_gb ?? null
    })
    .finally(() => {
      hardwareChecked.value = true
    })
  void window.api
    .validateHardware()
    .then((v) => {
      if (gen !== openGeneration) return
      hardwareWarning.value = v.warning ?? ''
    })
    .catch(() => {})
}

onMounted(() => {
  void open()
})

watch(
  step,
  (current) => {
    const mode = current === 'start' ? 'consent-lockdown' : 'post-consent'
    window.api.setFirstUseMode(mode)
    stepsSeen.add(current)
    emitTelemetryAction('comfy.desktop.first_use.step_viewed', {
      step: current,
      skip_pick: skipPick.value,
      has_legacy_desktop: hasLegacyDesktop.value
    })
  },
  { immediate: true }
)

onUnmounted(() => {
  clearTimeout(nudgeTimer)
  if (!completedFired) {
    const msOnScreen = Date.now() - mountedAt
    emitTelemetryAction('comfy.desktop.first_use.abandoned', {
      step: step.value,
      reason: acceptedTos.value ? 'consent_accepted' : 'pre_consent',
      ms_on_screen: msOnScreen,
      had_legacy: hasLegacyDesktop.value
    })
  }
  if (!chainHandoff) window.api.setFirstUseMode('none')
})

function resetContinue(): void {
  isContinuing.value = false
  chainHandoff = false
}

defineExpose({ open, resetContinue })
</script>

<template>
  <BrandTakeoverLayout
    v-if="isBrandStep"
    :aria-label="$t(step === 'localBranch' ? 'firstUse.localBranchTitle' : 'firstUse.pickTitle')"
  >
    <div
      v-if="step === 'start'"
      class="start-screen flex h-full w-full max-w-[760px] flex-col items-center gap-2"
    >
      <div
        class="start-hero relative z-1 flex w-full max-w-[760px] flex-auto flex-col items-center justify-center gap-[var(--takeover-gap-md)] text-center"
      >
        <h1
          class="first-use-title m-0 font-display text-[length:var(--takeover-fs-title)] leading-[1.15] font-extrabold tracking-normal text-[var(--legacy-color-text)] text-center opacity-85"
        >
          {{ $t('firstUse.pickTitle') }}
        </h1>
        <p
          class="first-use-lead mt-[var(--takeover-gap-md)] mb-[var(--takeover-gap-lg)] font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-200 text-center"
        >
          {{ $t('firstUse.pickLead') }}
        </p>
        <div
          class="start-cards grid w-full grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-8"
          role="radiogroup"
          :aria-label="$t('firstUse.pickTitle')"
          @keydown="onStartCardsKeydown"
        >
          <ChoiceCard
            class="start-card-cloud"
            :class="{
              'start-card-cloud--reco-dimmed [&_.start-cloud-reco]:opacity-70':
                hardwareRecommendsCloud && pickedChoice === 'local'
            }"
            selectable
            :selected="pickedChoice === 'cloud'"
            :tab-stop="pickedChoice === null"
            :aria-describedby="hardwareRecommendsCloud ? CLOUD_RECO_REASON_ID : undefined"
            glow
            :label="$t('cloud.label')"
            :tagline="$t('firstUse.cloudTagline')"
            :description="$t('firstUse.cloudDesc')"
            data-testid="first-use-pick-cloud"
            @click="pickChoice('cloud')"
          >
            <template #label-trailing>
              <Tooltip :text="$t('firstUse.whyTryCloud')">
                <Button
                  size="icon-sm"
                  variant="muted-textonly"
                  type="button"
                  class="start-cloud-info"
                  :aria-label="$t('firstUse.whyTryCloud')"
                  data-testid="first-use-why-cloud"
                  @click.stop="openWhyCloud"
                >
                  <Info :size="14" />
                </Button>
              </Tooltip>
              <span
                v-if="cloudFreeRunsEnabled && cloudUserTier === 'unknown'"
                class="start-cloud-runs-pill inline-flex items-center rounded-[999px] bg-comfy-yellow px-2 py-[3px] text-[10px] leading-[normal] font-bold tracking-[0.02em] whitespace-nowrap text-neutral-900 uppercase"
                data-testid="first-use-cloud-runs-pill"
                >{{ $t('firstUse.cloudFreeRunsPill') }}</span
              >
            </template>
            <template v-if="hardwareRecommendsCloud" #desc-trailing>
              <Tooltip :text="$t('firstUse.cloudRecommendedForHardwareTooltip')">
                <span
                  class="start-cloud-reco inline-flex cursor-default items-center gap-1 rounded-[999px] bg-[color-mix(in_oklab,var(--neutral-100)_12%,transparent)] px-[9px] py-[5px] text-xs leading-[normal] font-semibold text-neutral-100"
                  data-testid="first-use-cloud-reco"
                >
                  {{ $t('firstUse.cloudRecommendedForHardware') }}
                  <Info
                    :size="12"
                    class="start-cloud-reco__info shrink-0 opacity-70"
                    aria-hidden="true"
                  />
                </span>
              </Tooltip>
            </template>
          </ChoiceCard>
          <ChoiceCard
            selectable
            :selected="pickedChoice === 'local'"
            :label="$t('firstUse.localLabel')"
            :tagline="$t('firstUse.localTagline')"
            :description="$t('firstUse.localDesc')"
            data-testid="first-use-pick-local"
            @click="pickChoice('local')"
          />
        </div>
        <span
          v-if="hardwareRecommendsCloud"
          :id="CLOUD_RECO_REASON_ID"
          class="start-cloud-reco__reason absolute -m-px size-px overflow-hidden border-0 p-0 whitespace-nowrap [clip-path:inset(50%)]"
        >
          {{ $t('firstUse.cloudRecommendedForHardwareTooltip') }}
        </span>
        <div class="start-modifiers mx-auto mt-1 flex w-fit flex-col gap-2">
          <label
            v-if="hasLegacyDesktop"
            class="start-migrate-existing"
            :class="[
              modifierClass,
              showMigrateExisting
                ? 'opacity-100 [transform:translateY(0)]'
                : 'start-migrate-existing--hidden pointer-events-none opacity-0 [transform:translateY(-4px)]'
            ]"
            :aria-hidden="!showMigrateExisting"
            data-testid="first-use-migrate-existing"
          >
            <Checkbox
              :model-value="migrateExisting"
              class="mt-1"
              :tabindex="showMigrateExisting ? 0 : -1"
              @update:model-value="migrateExisting = $event === true"
            />
            <span class="start-migrate-existing__body flex min-w-0 flex-col items-start gap-0.5">
              <span class="start-migrate-existing__label leading-[1.4]">
                {{ $t('firstUse.migrateExistingLine') }}
              </span>
              <span
                class="start-migrate-existing__desc text-xs leading-[1.4] text-neutral-400 [&_strong]:font-medium [&_strong]:text-neutral-100"
              >
                <InlineRichText :text="$t('firstUse.migrateExistingDesc')" />
              </span>
            </span>
          </label>
          <label
            class="start-express"
            :class="[
              modifierClass,
              pickedChoice === 'local'
                ? 'opacity-100 [transform:translateY(0)]'
                : 'start-express--hidden pointer-events-none opacity-0 [transform:translateY(-4px)]'
            ]"
            :aria-hidden="pickedChoice !== 'local'"
            data-testid="first-use-express-install"
          >
            <Checkbox
              :model-value="expressInstall"
              class="mt-1"
              :tabindex="pickedChoice === 'local' ? 0 : -1"
              @update:model-value="expressInstall = $event === true"
            />
            <span class="start-express__body flex min-w-0 flex-col items-start gap-0.5">
              <span class="start-express__label leading-[1.4]">{{
                $t('firstUse.expressInstallLine')
              }}</span>
              <span
                class="start-express__gpu-hint min-h-[1.4em] text-xs leading-[1.4] text-neutral-400 transition-opacity duration-180 ease-out"
                :class="{
                  'start-express__gpu-hint--hidden pointer-events-none opacity-0': !showGpuHint
                }"
                :aria-hidden="!showGpuHint"
                data-testid="first-use-express-gpu-hint"
              >
                <template v-if="detectedGpuLabel">
                  {{ $t('firstUse.expressGpuHintPrefix')
                  }}<span class="start-express__gpu-vendor font-medium text-neutral-100">{{
                    detectedGpuLabel
                  }}</span
                  >{{ $t('firstUse.expressGpuHintSuffix') }}
                </template>
                <template v-else>&nbsp;</template>
              </span>
              <span
                v-if="showHardwareWarning"
                class="start-express__hardware-warning text-xs leading-[1.4] text-[var(--warning)]"
                role="alert"
                data-testid="first-use-hardware-warning"
              >
                {{ hardwareWarning }}
              </span>
            </span>
          </label>
        </div>
      </div>
      <div class="start-bottom w-[95%] flex-none">
        <div
          class="start-consent-strip flex w-full items-center justify-between gap-3 rounded-[10px] border border-solid border-[rgba(194,191,185,0.08)] bg-[rgba(138,134,136,0.06)] px-5 py-4 backdrop-blur-[40px]"
        >
          <div class="start-consent-rows flex min-w-0 flex-col gap-2">
            <label
              class="start-consent-row"
              :class="[
                consentClass,
                {
                  'start-consent-row--nudge animate-[first-use-consent-shake_400ms_cubic-bezier(0.36,0.07,0.19,0.97)_both] motion-reduce:animate-none':
                    tosNudge
                }
              ]"
              data-testid="first-use-consent-tos"
            >
              <Checkbox
                :model-value="acceptedTos"
                :class="[
                  'm-0',
                  {
                    'border-comfy-yellow shadow-[0_0_0_2px_color-mix(in_oklab,var(--comfy-yellow)_30%,transparent)] transition-[border-color,box-shadow] duration-150':
                      tosNudge
                  }
                ]"
                @update:model-value="acceptedTos = $event === true"
              />
              <span class="start-consent-row__text whitespace-normal">
                {{ $t('firstUse.consentTosHintPrefix') }}
                <Button
                  size="lg"
                  variant="textonly"
                  type="button"
                  :class="legalLinkClass"
                  data-testid="first-use-eula-link"
                  @click.prevent="termsDoc = 'eula'"
                >
                  {{ $t('firstUse.eulaLinkLabel') }}
                </Button>
                {{ $t('firstUse.consentTosHintSep') }}
                <Button
                  size="lg"
                  variant="textonly"
                  type="button"
                  :class="legalLinkClass"
                  data-testid="first-use-tos-link"
                  @click.prevent="termsDoc = 'tos'"
                >
                  {{ $t('firstUse.tosLinkLabel') }}</Button
                >{{ $t('firstUse.consentTosHintSuffix') }}
              </span>
            </label>
            <label
              class="start-consent-row"
              :class="consentClass"
              data-testid="first-use-consent-telemetry"
            >
              <Checkbox
                :model-value="telemetryEnabled"
                class="m-0"
                @update:model-value="telemetryEnabled = $event === true"
              />
              <span class="start-consent-row__text whitespace-normal">
                {{ $t('firstUse.consentTelemetryHint') }}
                <Button
                  size="lg"
                  variant="textonly"
                  type="button"
                  :class="legalLinkClass"
                  data-testid="first-use-telemetry-learn-more"
                  @click.prevent="termsDoc = 'privacy'"
                >
                  {{ $t('common.learnMore') }}
                </Button>
              </span>
            </label>
            <label
              class="start-consent-row"
              :class="consentClass"
              data-testid="first-use-consent-beta"
              :title="betaBlocked ? $t('tooltips.betaFeaturesNeedTelemetry') : undefined"
            >
              <Checkbox
                class="m-0"
                :model-value="betaFeaturesEnabled"
                :aria-readonly="betaBlocked"
                :aria-describedby="betaBlocked ? betaBlockedReasonId : undefined"
                @update:model-value="onBetaFeaturesToggle"
              />
              <span class="start-consent-row__text whitespace-normal">
                {{ $t('firstUse.consentBetaHint') }}
              </span>
              <span v-if="betaBlocked" :id="betaBlockedReasonId" class="sr-only">
                {{ $t('tooltips.betaFeaturesNeedTelemetry') }}
              </span>
            </label>
          </div>
          <Button
            size="lg"
            variant="inverted"
            class="start-continue min-w-40 shrink-0"
            :class="{ 'start-continue--locked cursor-not-allowed opacity-45': !acceptedTos }"
            type="button"
            data-testid="first-use-continue"
            :disabled="isContinuing || pickedChoice === null"
            :aria-busy="isContinuing"
            :aria-disabled="!acceptedTos"
            @click="onContinue"
          >
            <Loader2
              v-if="isContinuing"
              :size="16"
              class="start-continue__spinner shrink-0 animate-spin [animation-duration:750ms]"
              aria-hidden="true"
            />
            <span>{{
              isContinuing ? $t('firstUse.startContinueBusy') : $t('firstUse.startContinue')
            }}</span>
          </Button>
        </div>
      </div>
    </div>

    <div
      v-else-if="step === 'localBranch'"
      class="local-branch-hero relative z-1 flex w-full max-w-[820px] flex-col items-center text-center"
    >
      <h1
        class="first-use-title m-0 font-display text-[length:var(--takeover-fs-title)] leading-[1.15] font-extrabold tracking-normal text-[var(--legacy-color-text)] text-center opacity-85"
      >
        {{ $t('firstUse.localBranchTitle') }}
      </h1>
      <p
        class="first-use-lead mt-[var(--takeover-gap-md)] mb-[var(--takeover-gap-lg)] font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-200 text-center"
      >
        {{ $t('firstUse.localBranchLead') }}
      </p>
      <div
        class="local-branch-list flex w-full flex-col gap-4"
        role="radiogroup"
        :aria-label="$t('firstUse.localBranchTitle')"
      >
        <Button
          size="lg"
          variant="secondary"
          type="button"
          class="lb-card lb-card--recommended ring-1 ring-ring"
          :class="branchCardClass"
          data-testid="first-use-local-migrate"
          @click="chooseMigrate"
        >
          <span
            class="lb-card__icon inline-flex size-8 flex-none items-center justify-center rounded-md bg-[var(--chooser-surface-bg)] text-text"
            aria-hidden="true"
          >
            <FolderInput :size="16" :stroke-width="1.75" />
          </span>
          <span class="lb-card__text flex min-w-0 flex-auto flex-col gap-0.5">
            <span class="lb-card__label text-[length:var(--takeover-fs-body)] text-neutral-100">{{
              $t('firstUse.localBranchMigrateLabel')
            }}</span>
            <span class="lb-card__desc text-[length:var(--takeover-fs-body)] text-neutral-100">{{
              $t('firstUse.localBranchMigrateDesc')
            }}</span>
          </span>
          <Check
            class="lb-card__check flex-none text-neutral-100"
            :size="16"
            :stroke-width="2"
            aria-hidden="true"
          />
        </Button>
        <Button
          size="lg"
          variant="secondary"
          type="button"
          class="lb-card"
          :class="branchCardClass"
          data-testid="first-use-local-install-new"
          @click="chooseInstallNew"
        >
          <span
            class="lb-card__icon inline-flex size-8 flex-none items-center justify-center rounded-md bg-[var(--chooser-surface-bg)] text-text"
            aria-hidden="true"
          >
            <Copy :size="16" :stroke-width="1.75" />
          </span>
          <span
            class="lb-card__text lb-card__text--install-new flex min-w-0 flex-auto flex-col gap-0.5 opacity-50 hover:text-text hover:opacity-100 hover:transition-colors hover:duration-120 hover:ease-[ease]"
          >
            <span class="lb-card__label text-[length:var(--takeover-fs-body)] text-neutral-100">{{
              $t('firstUse.localBranchInstallNewLabel')
            }}</span>
            <span class="lb-card__desc text-[length:var(--takeover-fs-body)] text-neutral-100">{{
              $t('firstUse.localBranchInstallNewDesc')
            }}</span>
          </span>
        </Button>
      </div>
    </div>

    <template #footer-left>
      <Button
        v-if="step === 'localBranch'"
        size="lg"
        variant="textonly"
        class="pick-why-cloud absolute bottom-[clamp(1.25rem,2vw,2rem)] left-[clamp(1.25rem,2vw,2rem)] z-2"
        data-testid="first-use-local-branch-back"
        type="button"
        @click="step = 'start'"
      >
        ← {{ $t('common.back') }}
      </Button>
    </template>

    <WhyTryCloudModal
      v-if="whyCloudOpen"
      @close="dismissWhyCloud('dismiss')"
      @try-cloud="onWhyCloudTryCloud"
    />
    <TermsModal
      v-if="termsDoc"
      :open="termsDoc !== null"
      :doc="termsDoc"
      @close="termsDoc = null"
    />
  </BrandTakeoverLayout>
  <ModalShell v-else binding hide-close content-class="first-use-takeover flex flex-col">
    <template #header>
      <TakeoverHeader :title="$t('firstUse.grandTitle')" :subtitle="$t('firstUse.grandSubtitle')" />
    </template>
    <div class="first-use-scroll min-h-0 flex-1 overflow-y-auto pr-2">
      <template v-if="step === 'mirrors'">
        <h3
          class="first-use-step-title mt-0 mr-0 mb-3 ml-0 text-lg leading-[1.5] font-semibold text-text"
        >
          {{ $t('settings.chineseMirrorsSuggestTitle') }}
        </h3>
        <p class="first-use-mirrors-lead mb-3 text-[15px] leading-[1.6] text-text">
          {{ $t('settings.chineseMirrorsSuggestMessage') }}
        </p>
      </template>
    </div>

    <div
      class="first-use-footer grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 pt-4 [&>:last-child]:justify-self-end"
    >
      <div class="wizard-back-placeholder"></div>
      <div></div>
      <template v-if="step === 'mirrors'">
        <div class="first-use-mirror-buttons flex gap-2">
          <Button
            type="button"
            size="lg"
            variant="secondary"
            class="first-use-mirrors-skip"
            data-testid="first-use-mirrors-skip"
            @click="chooseMirrors(false)"
          >
            {{ $t('firstUse.notNow') }}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="inverted"
            class="first-use-mirrors-accept"
            data-testid="first-use-mirrors-accept"
            @click="chooseMirrors(true)"
          >
            {{ $t('settings.chineseMirrorsSuggestConfirm') }}
          </Button>
        </div>
      </template>
      <template v-else>
        <div></div>
      </template>
    </div>
  </ModalShell>
</template>

<style>
@keyframes first-use-consent-shake {
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
