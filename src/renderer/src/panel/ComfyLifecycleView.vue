<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCcw, Loader2, ArrowLeft } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import { useSessionStore } from '../stores/sessionStore'
import {
  useReturnToDashboardConfirm,
  type ReturnToDashboardReason
} from '../composables/useReturnToDashboardConfirm'
import { emitTelemetryAction } from '../lib/telemetry'
import BrandFinishedSurface from '../components/BrandFinishedSurface.vue'
import { TID } from '../../../shared/testIds'
import type { Installation, ShowProgressOpts } from '../types/ipc'

interface Props {
  installation: Installation | null
  installationId: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'show-progress': [opts: ShowProgressOpts]
}>()

const { t } = useI18n()
const sessionStore = useSessionStore()

type LifecycleState = 'running' | 'launching' | 'stopping' | 'crashed' | 'stopped' | 'unknown'

const state = computed<LifecycleState>(() => {
  if (!sessionStore.ready) return 'unknown'
  const id = props.installationId
  if (sessionStore.isRunning(id)) return 'running'
  if (sessionStore.isLaunching(id)) return 'launching'
  if (sessionStore.isStopping(id)) return 'stopping'
  if (sessionStore.errorInstances.has(id)) return 'crashed'
  return 'stopped'
})

const errorInfo = computed(() => sessionStore.errorInstances.get(props.installationId) ?? null)

const launchFailedMessage = computed<string | null>(() => {
  if (state.value !== 'crashed') return null
  const info = errorInfo.value
  if (!info?.message || info.exitCode != null || info.signal) return null
  return info.message
})

const crashedLogs = computed<string | null>(() => {
  if (state.value !== 'crashed') return null
  return errorInfo.value?.lastStderr ?? null
})

const crashedMessage = computed<string | null>(() => {
  if (state.value !== 'crashed') return null
  const code = errorInfo.value?.exitCode
  const signal = errorInfo.value?.signal
  const hex = errorInfo.value?.exitCodeHex
  let base: string
  if (errorInfo.value?.crashKind === 'access-violation' && code != null) {
    base = t('comfyLifecycle.crashedDescAccessViolation', { code, hex: hex ?? code })
  } else if (hex && code != null) {
    base = t('comfyLifecycle.crashedDescWithCodeHex', { code, hex })
  } else if (signal && code != null) {
    base = t('comfyLifecycle.crashedDescWithCodeAndSignal', { code, signal })
  } else if (signal) {
    base = t('comfyLifecycle.crashedDescWithSignal', { signal })
  } else if (code != null) {
    base = t('comfyLifecycle.crashedDescWithCode', { code })
  } else {
    base = t('comfyLifecycle.crashedDesc')
  }
  if ((errorInfo.value?.vcRuntimeMissing?.length ?? 0) > 0) {
    base = `${base} ${t('comfyLifecycle.crashedDescVcRuntimeHint')}`
  }
  if (crashedLogs.value) {
    return `${base} ${t('comfyLifecycle.crashedDescLogsHint')}`
  }
  return base
})

const UNKNOWN_PLACEHOLDER_GRACE_MS = 150
const showUnknownPlaceholder = ref(false)
let unknownGraceTimer: ReturnType<typeof setTimeout> | null = null

function clearUnknownGraceTimer(): void {
  if (unknownGraceTimer) {
    clearTimeout(unknownGraceTimer)
    unknownGraceTimer = null
  }
}

watch(
  () => state.value === 'unknown',
  (isUnknown) => {
    clearUnknownGraceTimer()
    if (!isUnknown) {
      showUnknownPlaceholder.value = false
      return
    }
    unknownGraceTimer = setTimeout(() => {
      showUnknownPlaceholder.value = true
      unknownGraceTimer = null
    }, UNKNOWN_PLACEHOLDER_GRACE_MS)
  },
  { immediate: true }
)

onBeforeUnmount(clearUnknownGraceTimer)

async function hydrateLastCrashError(installationId: string): Promise<void> {
  if (!installationId) return
  if (sessionStore.errorInstances.has(installationId)) return
  try {
    const data = await window.api.getLastCrashError(installationId)
    if (!data || !data.crashed) return
    if (sessionStore.errorInstances.has(installationId)) return
    sessionStore.errorInstances.set(installationId, {
      installationName: data.installationName,
      exitCode: data.exitCode,
      signal: data.signal,
      lastStderr: data.lastStderr,
      exitCodeHex: data.exitCodeHex,
      crashKind: data.crashKind,
      vcRuntimeMissing: data.vcRuntimeMissing,
      crashedAtMs: data.crashedAtMs
    })
  } catch {}
}

onMounted(() => {
  void hydrateLastCrashError(props.installationId)
})

watch(
  () => props.installationId,
  (id) => {
    void hydrateLastCrashError(id)
  }
)

const installationName = computed(() => props.installation?.name ?? '')

function startLaunch(): void {
  if (!props.installationId) return
  if (state.value === 'crashed' && !launchFailedMessage.value) {
    const errorInfoSnapshot = sessionStore.errorInstances.get(props.installationId)
    const crashedAtMs = errorInfoSnapshot?.crashedAtMs
    emitTelemetryAction('comfy.desktop.instance.relaunched_after_crash', {
      installation_id: props.installationId,
      crash_to_relaunch_seconds:
        crashedAtMs != null ? Math.round((Date.now() - crashedAtMs) / 1000) : null
    })
  }
  emit('show-progress', {
    installationId: props.installationId,
    title: installationName.value
      ? `${t('comfyLifecycle.launchProgressTitle')} — ${installationName.value}`
      : t('comfyLifecycle.launchProgressTitle'),
    apiCall: () => window.api.runAction(props.installationId, 'launch'),
    cancellable: true,
    opKind: 'launch'
  })
}

const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

async function returnToDashboard(): Promise<void> {
  const reason: ReturnToDashboardReason =
    state.value === 'crashed' ? 'crashed' : state.value === 'stopped' ? 'stopped' : 'running'
  const ok = await confirmReturnToDashboard(props.installation, reason)
  if (!ok) return
  emitTelemetryAction('comfy.desktop.instance.return_to_dashboard', { from: 'lifecycle', reason })
  await window.api.returnToDashboard()
}

const showPlaceholder = computed<boolean>(() => {
  if (state.value === 'unknown') return showUnknownPlaceholder.value
  return state.value === 'launching' || state.value === 'stopping'
})

const placeholderTitle = computed<string>(() => {
  if (state.value === 'launching') return t('comfyLifecycle.launchingTitle')
  if (state.value === 'stopping') return t('comfyLifecycle.stoppingTitle')
  return t('comfyLifecycle.preparingTitle')
})
</script>

<template>
  <div
    class="lifecycle-view flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)] p-6 text-text"
  >
    <BrandFinishedSurface
      v-if="state === 'crashed'"
      :title="
        launchFailedMessage
          ? $t('comfyLifecycle.launchFailedTitle')
          : $t('comfyLifecycle.crashedTitle')
      "
      :message="launchFailedMessage ?? crashedMessage ?? undefined"
      :logs="crashedLogs ?? undefined"
      :aria-label="
        launchFailedMessage
          ? $t('comfyLifecycle.launchFailedTitle')
          : $t('comfyLifecycle.crashedTitle')
      "
    >
      <template #actions="{ buttonClass, secondaryClass, primaryClass }">
        <Button
          size="unset"
          variant="textonly"
          class="brand-progress__footer-btn"
          :class="[buttonClass, secondaryClass]"
          type="button"
          :data-testid="TID.lifecycleReturnDashboard"
          @click="returnToDashboard"
        >
          <ArrowLeft :size="14" />
          {{ $t('common.back') }}
        </Button>
        <Button
          size="unset"
          variant="textonly"
          class="brand-progress__footer-btn"
          :class="[buttonClass, primaryClass]"
          type="button"
          :data-testid="TID.lifecycleRelaunch"
          @click="startLaunch"
        >
          <RefreshCcw :size="14" />
          {{ $t('comfyLifecycle.restart') }}
        </Button>
      </template>
    </BrandFinishedSurface>

    <BrandFinishedSurface
      v-else-if="state === 'stopped'"
      tone="neutral"
      :title="$t('comfyLifecycle.stoppedTitle')"
      :message="$t('comfyLifecycle.stoppedDesc')"
      :aria-label="$t('comfyLifecycle.stoppedTitle')"
    >
      <template #actions="{ buttonClass, secondaryClass, primaryClass }">
        <Button
          size="unset"
          variant="textonly"
          class="brand-progress__footer-btn"
          :class="[buttonClass, secondaryClass]"
          type="button"
          :data-testid="TID.lifecycleReturnDashboard"
          @click="returnToDashboard"
        >
          <ArrowLeft :size="14" />
          {{ $t('dashboard.confirmStopLocal.confirmLabel', 'Return to Dashboard') }}
        </Button>
        <Button
          size="unset"
          variant="textonly"
          class="brand-progress__footer-btn"
          :class="[buttonClass, primaryClass]"
          type="button"
          :data-testid="TID.lifecycleRelaunch"
          @click="startLaunch"
        >
          <RefreshCcw :size="14" />
          {{ $t('comfyLifecycle.relaunch') }}
        </Button>
      </template>
    </BrandFinishedSurface>

    <div
      v-else-if="showPlaceholder"
      class="lifecycle-placeholder flex max-w-[480px] flex-col items-center gap-3 px-8 py-7 text-center"
      data-state="placeholder"
    >
      <div
        class="lifecycle-placeholder__icon inline-flex size-14 items-center justify-center rounded-[999px] border border-solid border-[var(--border)] bg-surface text-[var(--action,#4d8eff)]"
      >
        <Loader2 :size="32" class="animate-spin" />
      </div>
      <h2 class="m-0 text-[18px] font-semibold">{{ placeholderTitle }}</h2>
    </div>
  </div>
</template>
