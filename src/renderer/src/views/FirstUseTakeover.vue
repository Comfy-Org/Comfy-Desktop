<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, HardDrive, Loader2, Package, Zap } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import TermsModal from '../components/TermsModal.vue'
import InlineRichText from '../components/InlineRichText.vue'
import BuildDeviceArt from '../panel/home/BuildDeviceArt.vue'
import { deviceKindForPlatform } from '../panel/home/homeBuild'
import { emitTelemetryAction } from '../lib/telemetry'
import { formatSize } from '../lib/formatting'
import {
  displayPath,
  installLocation,
  isCpuVariant,
  machineName,
  planVersion,
  resolveSetupPlan,
  setupPlatform,
  type SetupPlan
} from '../lib/setupPlan'
import type { SystemInfo } from '../../../types/ipc'

type Step = 'setup' | 'mirrors'
type SetupAction = 'install' | 'change' | 'skip'
type ExitPath = 'local-new' | 'local-configure' | 'local-migrate' | 'skipped'

const emit = defineEmits<{
  install: [plan: SetupPlan]
  change: [{ consented: boolean }]
  'complete-skip': []
  'chain-migrate': [{ express: boolean }]
}>()

const { t } = useI18n()

const ROW_CLASS = 'grid h-4 grid-cols-[147px_minmax(0,1fr)_auto] items-center text-[13px]/4'
const CONSENT_ROW_CLASS = 'flex w-fit cursor-pointer items-center gap-2.5 text-xs/[15px]'
const CHECKBOX_CLASS =
  'size-5 rounded-[5px] border-0 bg-white/6 text-[#070709] data-[state=checked]:bg-[#f1f1f3] [&_i]:size-3'
const LINK_CLASS =
  'inline h-auto p-0 align-baseline text-xs/[15px] font-normal text-foreground underline underline-offset-2 hover:bg-transparent'

const platform = window.api.platform
const step = ref<Step>('setup')
const plan = ref<SetupPlan | null>(null)
const planState = ref<'loading' | 'ready' | 'unavailable'>('loading')
const systemInfo = ref<SystemInfo | null>(null)
const diskFree = ref<number | null>(null)
const unsupportedReason = ref('')
const hardwareWarning = ref('')

const acceptedTos = ref(false)
const tosNudge = ref(false)
const telemetryEnabled = ref(true)
const betaFeaturesEnabled = ref(true)
const betaTouched = ref(false)
const preservePersistedBetaOptIn = ref(false)
const betaBlocked = computed(() => !telemetryEnabled.value && !betaFeaturesEnabled.value)
const betaBlockedReasonId = useId()
const termsDoc = ref<'eula' | 'tos' | 'privacy' | null>(null)

const skipPick = ref(false)
const hasLegacyDesktop = ref(false)
const migrateExisting = ref(true)
const busy = ref(false)
const pendingAction = ref<SetupAction | null>(null)
const locale = ref('en')

let openGeneration = 0
let mountedAt = Date.now()
let completedFired = false
let chainHandoff = false

const variant = computed(() => plan.value?.selections.variant)
const cpuOnly = computed(() => isCpuVariant(variant.value))
const machine = computed(() => machineName(systemInfo.value, cpuOnly.value))
const memoryGb = computed(() =>
  systemInfo.value?.total_memory_gb ? Math.round(systemInfo.value.total_memory_gb) : null
)
const title = computed(() => t(`setup.title.${setupPlatform(platform)}`))
const lead = computed(() =>
  machine.value ? t('setup.lead', { machine: machine.value }) : t('setup.leadChecking')
)
const location = computed(() =>
  displayPath(installLocation(plan.value?.installRoot ?? '', platform), platform)
)
const lowDisk = computed(
  () =>
    diskFree.value !== null &&
    !!plan.value?.requiredBytes &&
    diskFree.value < plan.value.requiredBytes
)
const locationMeta = computed(() => {
  if (diskFree.value === null || !plan.value) return ''
  const values = {
    free: formatSize(diskFree.value),
    required: formatSize(plan.value.requiredBytes)
  }
  if (!plan.value.requiredBytes) return t('setup.free', values)
  return t(lowDisk.value ? 'setup.notEnoughSpace' : 'setup.freeRequired', values)
})
const version = computed(() => {
  if (!plan.value) return ''
  const tag = planVersion(plan.value)
  const channel = plan.value.selections.release?.label ?? ''
  return tag
    ? t('setup.versionValue', { version: tag, channel })
    : t('setup.versionChannel', { channel })
})
const downloadSize = computed(() => formatSize(plan.value?.downloadBytes ?? 0))
const footerSummary = computed(() =>
  plan.value?.downloadBytes
    ? t('setup.downloadRequired', {
        download: downloadSize.value,
        required: formatSize(plan.value.requiredBytes)
      })
    : ''
)
const migrating = computed(() => hasLegacyDesktop.value && migrateExisting.value)
const installBlocked = computed(
  () => !migrating.value && (planState.value !== 'ready' || unsupportedReason.value !== '')
)
const isChinese = computed(() => locale.value.startsWith('zh'))

function applyBetaEntryRule(): void {
  if (!telemetryEnabled.value) {
    if (!preservePersistedBetaOptIn.value) betaFeaturesEnabled.value = false
    return
  }
  if (!betaTouched.value) betaFeaturesEnabled.value = true
}

watch(telemetryEnabled, applyBetaEntryRule)
watch(acceptedTos, (accepted) => {
  if (accepted) tosNudge.value = false
})

function onBetaFeaturesToggle(value: boolean | 'indeterminate'): void {
  const next = value === true
  if (!telemetryEnabled.value && next) return
  preservePersistedBetaOptIn.value = false
  betaTouched.value = true
  betaFeaturesEnabled.value = next
}

function emitCompleted(exitPath: ExitPath): void {
  chainHandoff = exitPath !== 'skipped'
  if (completedFired) return
  completedFired = true
  const durationMs = Date.now() - mountedAt
  emitTelemetryAction('comfy.desktop.first_use.completed', {
    exit_path: exitPath,
    steps_seen: step.value === 'mirrors' ? 2 : 1,
    duration_ms: durationMs,
    duration_seconds: Math.round(durationMs / 1000),
    had_legacy: hasLegacyDesktop.value,
    had_existing_install: skipPick.value,
    gpu_tier: systemInfo.value?.gpu_tier ?? null
  })
}

async function saveConsent(): Promise<void> {
  await window.api.setSetting('telemetryEnabled', telemetryEnabled.value)
  await window.api.setSetting('betaFeaturesEnabled', betaFeaturesEnabled.value)
  emitTelemetryAction('comfy.desktop.first_use.consent_decision', {
    decision: telemetryEnabled.value ? 'accept' : 'decline',
    telemetry_enabled: telemetryEnabled.value,
    locale: locale.value
  })
}

async function request(action: SetupAction): Promise<void> {
  if (busy.value) return
  if (action !== 'change' && !acceptedTos.value) {
    tosNudge.value = true
    return
  }
  if (action === 'install' && installBlocked.value) return
  busy.value = true
  await saveConsent()
  emitTelemetryAction('comfy.desktop.first_use.setup_action', {
    action: action === 'install' && migrating.value ? 'migrate' : action,
    plan_ready: planState.value === 'ready'
  })
  if (isChinese.value) {
    pendingAction.value = action
    step.value = 'mirrors'
    busy.value = false
    return
  }
  route(action)
}

function route(action: SetupAction): void {
  if (action === 'skip') {
    emitCompleted('skipped')
    emit('complete-skip')
    return
  }
  if (action === 'change') {
    emitCompleted('local-configure')
    emit('change', { consented: acceptedTos.value })
    return
  }
  if (migrating.value) {
    emitCompleted('local-migrate')
    emit('chain-migrate', { express: false })
    return
  }
  if (!plan.value) {
    busy.value = false
    return
  }
  emitCompleted('local-new')
  emit('install', plan.value)
}

async function chooseMirrors(useMirrors: boolean): Promise<void> {
  await Promise.all([
    window.api.setSetting('useChineseMirrors', useMirrors),
    window.api.setSetting('chineseMirrorsPrompted', true)
  ])
  emitTelemetryAction('comfy.desktop.first_use.mirrors_chosen', { use_mirrors: useMirrors })
  const action = pendingAction.value ?? 'install'
  pendingAction.value = null
  busy.value = true
  route(action)
}

async function loadPlan(gen: number): Promise<void> {
  planState.value = 'loading'
  try {
    const next = await resolveSetupPlan()
    if (gen !== openGeneration) return
    plan.value = next
    planState.value = 'ready'
    if (next.installRoot) {
      void window.api
        .getDiskSpace(next.installRoot)
        .then((space) => {
          if (gen === openGeneration) diskFree.value = space.free
        })
        .catch(() => {})
    }
  } catch (err) {
    if (gen !== openGeneration) return
    console.warn('[setup] could not resolve the recommended install', err)
    plan.value = null
    planState.value = 'unavailable'
  }
}

function retryPlan(): void {
  void loadPlan(openGeneration)
}

interface OpenOpts {
  skipPick?: boolean
  hasLegacyDesktop?: boolean
}

async function open(opts: OpenOpts = {}): Promise<void> {
  const gen = ++openGeneration
  step.value = 'setup'
  skipPick.value = opts.skipPick === true
  hasLegacyDesktop.value = opts.hasLegacyDesktop === true
  migrateExisting.value = true
  termsDoc.value = null
  acceptedTos.value = false
  tosNudge.value = false
  busy.value = false
  pendingAction.value = null
  mountedAt = Date.now()
  completedFired = false
  chainHandoff = false
  unsupportedReason.value = ''
  hardwareWarning.value = ''
  diskFree.value = null
  void loadPlan(gen)
  void window.api
    .getSystemInfo()
    .then((info) => {
      if (gen === openGeneration) systemInfo.value = info
    })
    .catch(() => {})
  void window.api
    .validateHardware()
    .then((result) => {
      if (gen !== openGeneration) return
      unsupportedReason.value = result.supported ? '' : (result.error ?? '')
      hardwareWarning.value = result.warning ?? ''
    })
    .catch(() => {})
  void window.api
    .getLocale()
    .then((next) => {
      locale.value = next
    })
    .catch(() => {})
  const [existing, existingBeta] = (await Promise.all([
    window.api.getSetting('telemetryEnabled'),
    window.api.getSetting('betaFeaturesEnabled')
  ])) as [boolean | undefined, boolean | undefined]
  telemetryEnabled.value = existing !== false
  betaTouched.value = typeof existingBeta === 'boolean'
  preservePersistedBetaOptIn.value = existingBeta === true
  betaFeaturesEnabled.value = betaTouched.value ? existingBeta === true : telemetryEnabled.value
  applyBetaEntryRule()
}

function resetContinue(): void {
  busy.value = false
  chainHandoff = false
  completedFired = false
}

onMounted(() => {
  void open()
})

watch(
  step,
  (current) => {
    window.api.setFirstUseMode(
      current === 'setup' || !acceptedTos.value ? 'consent-lockdown' : 'post-consent'
    )
    emitTelemetryAction('comfy.desktop.first_use.step_viewed', {
      step: current,
      skip_pick: skipPick.value,
      has_legacy_desktop: hasLegacyDesktop.value
    })
  },
  { immediate: true }
)

onUnmounted(() => {
  if (!completedFired) {
    emitTelemetryAction('comfy.desktop.first_use.abandoned', {
      step: step.value,
      reason: acceptedTos.value ? 'consent_accepted' : 'pre_consent',
      ms_on_screen: Date.now() - mountedAt,
      had_legacy: hasLegacyDesktop.value
    })
  }
  if (!chainHandoff) window.api.setFirstUseMode('none')
})

defineExpose({ open, resetContinue })
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="step === 'mirrors' ? t('settings.chineseMirrorsSuggestTitle') : title"
    :dismiss-on-escape="false"
    :dismiss-on-outside="false"
    overlay-class="fixed inset-0 z-50 flex bg-window-background p-2"
    content-class="relative flex size-full max-h-none max-w-none flex-col overflow-y-auto rounded-shell bg-[#0d0d0f] bg-[radial-gradient(70%_62%_at_50%_0%,rgb(241_241_241/0.07),rgb(241_241_241/0)_70%)] outline-none"
    data-testid="setup-screen"
  >
    <ComfyWordmark
      class="absolute top-5 left-1/2 h-7 w-[100px] -translate-x-1/2 text-[#f0f0f0]"
      aria-hidden="true"
    />

    <div class="m-auto flex w-[638px] max-w-[calc(100%-48px)] flex-col py-24">
      <template v-if="step === 'setup'">
        <h1 class="m-0 text-[22px]/[27px] font-semibold text-foreground">{{ title }}</h1>
        <p class="mt-1.5 mb-0 text-[13px]/4 text-muted-foreground" data-testid="setup-lead">
          {{ lead }}
        </p>

        <section
          class="relative mt-[26px] flex h-[165px] items-center overflow-hidden rounded-[18px] border border-white/7 bg-[rgb(137_137_137/0.05)] pr-8 pl-[35px]"
          :aria-label="t('setup.computer')"
          data-testid="setup-machine"
        >
          <span
            class="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_15%_0%,rgb(244_244_244/0.09),rgb(244_244_244/0)_70%)]"
            aria-hidden="true"
          />
          <BuildDeviceArt
            class="relative h-[104px] w-[162px] shrink-0"
            :kind="deviceKindForPlatform(platform)"
            glow="#46464A"
          />
          <div class="relative ml-[33px] flex min-w-0 flex-1 flex-col">
            <span class="flex h-[15px] items-center gap-1.5 text-xs/[15px] text-muted-foreground">
              <Check :size="11" :stroke-width="2" aria-hidden="true" />
              {{ t('setup.detected') }}
            </span>
            <span
              class="mt-[5px] truncate text-[22px]/[27px] font-semibold text-foreground"
              data-testid="setup-machine-name"
            >
              {{ machine || t('setup.thisComputer') }}
            </span>
            <span class="mt-[3px] h-4 text-[13px]/4 text-subtle-foreground">
              {{ memoryGb ? t('setup.memory', { gb: memoryGb }) : '' }}
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="unset"
            class="relative h-8 shrink-0 rounded-lg bg-[rgb(244_244_244/0.09)] px-[13px] text-[13px]/4 font-normal text-foreground hover:bg-[rgb(244_244_244/0.14)]"
            data-testid="setup-change"
            @click="request('change')"
          >
            {{ t('setup.change') }}
          </Button>
        </section>

        <section
          class="mt-3 flex flex-col gap-8 rounded-[14px] border border-white/7 bg-[rgb(230_230_230/0.04)] py-5 pr-[31px] pl-[33px]"
          :aria-label="t('setup.summary')"
          data-testid="setup-summary"
        >
          <template v-if="planState !== 'unavailable'">
            <div :class="ROW_CLASS" data-testid="setup-row-hardware">
              <span class="flex items-center gap-2.5 text-subtle-foreground">
                <Zap :size="13" :stroke-width="1.75" aria-hidden="true" />{{ t('setup.hardware') }}
              </span>
              <span class="truncate text-foreground">
                {{ variant?.label ?? t('setup.checking') }}
              </span>
              <span
                class="ml-4 text-right whitespace-nowrap"
                :class="
                  unsupportedReason || hardwareWarning ? 'text-[#f0b135]' : 'text-subtle-foreground'
                "
                :title="unsupportedReason || hardwareWarning || undefined"
              >
                {{
                  unsupportedReason
                    ? t('setup.unsupported')
                    : cpuOnly
                      ? t('setup.noGpu')
                      : variant
                        ? t('setup.detected')
                        : ''
                }}
              </span>
            </div>
            <div :class="ROW_CLASS" data-testid="setup-row-location">
              <span class="flex items-center gap-2.5 text-subtle-foreground">
                <HardDrive :size="13" :stroke-width="1.75" aria-hidden="true" />{{
                  t('setup.location')
                }}
              </span>
              <span class="truncate text-foreground" :title="location || undefined">
                {{ location || t('setup.checking') }}
              </span>
              <span
                class="ml-4 text-right whitespace-nowrap"
                :class="lowDisk ? 'text-[#f0b135]' : 'text-subtle-foreground'"
                data-testid="setup-location-meta"
              >
                {{ locationMeta }}
              </span>
            </div>
            <div :class="ROW_CLASS" data-testid="setup-row-version">
              <span class="flex items-center gap-2.5 text-subtle-foreground">
                <Package :size="13" :stroke-width="1.75" aria-hidden="true" />{{
                  t('setup.version')
                }}
              </span>
              <span class="truncate text-foreground">{{ version || t('setup.checking') }}</span>
              <span class="ml-4 text-right whitespace-nowrap text-subtle-foreground">
                {{ downloadSize ? t('setup.download', { size: downloadSize }) : '' }}
              </span>
            </div>
          </template>
          <div
            v-else
            class="flex min-h-16 items-center justify-between gap-4 text-[13px]/4"
            role="alert"
            data-testid="setup-unavailable"
          >
            <span class="text-muted-foreground">{{ t('setup.unavailable') }}</span>
            <Button
              type="button"
              variant="secondary"
              size="unset"
              class="h-8 shrink-0 rounded-lg px-3 text-[13px]/4 font-normal"
              @click="retryPlan"
            >
              {{ t('setup.retry') }}
            </Button>
          </div>
        </section>

        <div class="mt-9 flex flex-col gap-2.5 pl-8">
          <label
            v-if="hasLegacyDesktop"
            :class="CONSENT_ROW_CLASS"
            data-testid="setup-migrate-existing"
          >
            <Checkbox
              :model-value="migrateExisting"
              :class="CHECKBOX_CLASS"
              @update:model-value="migrateExisting = $event === true"
            />
            <span class="text-subtle-foreground [&_strong]:font-normal [&_strong]:text-foreground">
              <InlineRichText :text="t('setup.migrateExisting')" />
            </span>
          </label>
          <label
            :class="CONSENT_ROW_CLASS"
            data-testid="setup-consent-tos"
            :data-nudge="tosNudge || undefined"
          >
            <Checkbox
              :model-value="acceptedTos"
              :class="[CHECKBOX_CLASS, tosNudge && 'ring-[3px] ring-[rgb(241_178_52/0.35)]']"
              :aria-describedby="tosNudge ? 'setup-agree-hint' : undefined"
              @update:model-value="acceptedTos = $event === true"
            />
            <span class="text-subtle-foreground">
              {{ t('firstUse.consentTosHintPrefix') }}
              <Button
                type="button"
                variant="textonly"
                size="unset"
                :class="LINK_CLASS"
                data-testid="setup-eula-link"
                @click.prevent="termsDoc = 'eula'"
                >{{ t('firstUse.eulaLinkLabel') }}</Button
              >
              {{ t('firstUse.consentTosHintSep') }}
              <Button
                type="button"
                variant="textonly"
                size="unset"
                :class="LINK_CLASS"
                data-testid="setup-tos-link"
                @click.prevent="termsDoc = 'tos'"
                >{{ t('firstUse.tosLinkLabel') }}</Button
              >{{ t('firstUse.consentTosHintSuffix') }}
              <span
                v-if="tosNudge"
                id="setup-agree-hint"
                class="text-[#f0b135]"
                role="status"
                data-testid="setup-agree-hint"
                >{{ t('setup.agreeToInstall') }}</span
              >
            </span>
          </label>
          <label :class="CONSENT_ROW_CLASS" data-testid="setup-consent-telemetry">
            <Checkbox
              :model-value="telemetryEnabled"
              :class="CHECKBOX_CLASS"
              @update:model-value="telemetryEnabled = $event === true"
            />
            <span class="text-subtle-foreground">
              {{ t('firstUse.consentTelemetryHint') }}
              <Button
                type="button"
                variant="textonly"
                size="unset"
                :class="[LINK_CLASS, 'text-muted-foreground']"
                data-testid="setup-telemetry-learn-more"
                @click.prevent="termsDoc = 'privacy'"
                >{{ t('common.learnMore') }}</Button
              >
            </span>
          </label>
          <label
            :class="CONSENT_ROW_CLASS"
            data-testid="setup-consent-beta"
            :title="betaBlocked ? t('tooltips.betaFeaturesNeedTelemetry') : undefined"
          >
            <Checkbox
              :model-value="betaFeaturesEnabled"
              :class="CHECKBOX_CLASS"
              :aria-readonly="betaBlocked"
              :aria-describedby="betaBlocked ? betaBlockedReasonId : undefined"
              @update:model-value="onBetaFeaturesToggle"
            />
            <span class="text-subtle-foreground">{{ t('firstUse.consentBetaHint') }}</span>
            <span v-if="betaBlocked" :id="betaBlockedReasonId" class="sr-only">
              {{ t('tooltips.betaFeaturesNeedTelemetry') }}
            </span>
          </label>
        </div>

        <div class="mt-10 flex min-h-9 items-center justify-end gap-5">
          <span
            v-if="unsupportedReason && !migrating"
            class="mr-auto text-xs/[15px] text-[#f0b135]"
            role="alert"
            data-testid="setup-unsupported"
          >
            {{ unsupportedReason }}
          </span>
          <span v-else class="text-xs/[15px] text-subtle-foreground">{{ footerSummary }}</span>
          <Button
            v-if="skipPick"
            type="button"
            variant="secondary"
            size="unset"
            class="h-9 rounded-[10px] px-4 text-[13px]/4 font-normal"
            data-testid="setup-skip"
            @click="request('skip')"
          >
            {{ t('setup.useMyBuilds') }}
          </Button>
          <Button
            type="button"
            variant="inverted"
            size="unset"
            class="h-9 gap-2 rounded-[10px] bg-[#f1f1f3] px-4 text-[13px]/4 font-normal text-[#070709] hover:bg-white"
            :aria-disabled="installBlocked || undefined"
            :aria-busy="busy || undefined"
            data-testid="setup-install"
            @click="request('install')"
          >
            <Loader2
              v-if="busy"
              :size="14"
              class="animate-spin [animation-duration:750ms]"
              aria-hidden="true"
            />
            {{ migrating ? t('setup.migrate') : t('setup.install') }}
          </Button>
        </div>
      </template>

      <template v-else>
        <h1 class="m-0 text-[22px]/[27px] font-semibold text-foreground">
          {{ t('settings.chineseMirrorsSuggestTitle') }}
        </h1>
        <p class="mt-3 mb-0 text-[13px]/5 text-muted-foreground">
          {{ t('settings.chineseMirrorsSuggestMessage') }}
        </p>
        <div class="mt-10 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="unset"
            class="h-9 rounded-[10px] px-4 text-[13px]/4 font-normal"
            data-testid="setup-mirrors-skip"
            @click="chooseMirrors(false)"
          >
            {{ t('firstUse.notNow') }}
          </Button>
          <Button
            type="button"
            variant="inverted"
            size="unset"
            class="h-9 rounded-[10px] bg-[#f1f1f3] px-4 text-[13px]/4 font-normal text-[#070709] hover:bg-white"
            data-testid="setup-mirrors-accept"
            @click="chooseMirrors(true)"
          >
            {{ t('settings.chineseMirrorsSuggestConfirm') }}
          </Button>
        </div>
      </template>
    </div>

    <TermsModal v-if="termsDoc" :open="true" :doc="termsDoc" @close="termsDoc = null" />
  </DesktopDialogSurface>
</template>
