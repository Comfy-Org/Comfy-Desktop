<script setup lang="ts">
import { ref, computed, watch, onMounted, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { useModal } from '../composables/useModal'

import type { Source, FieldOption, ShowProgressOpts } from '../types/ipc'
import { emitTelemetryAction, toVariantBucket } from '../lib/telemetry'
import { stripVariantPrefix, sortedCardOptions } from '../lib/variants'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import VariantCardGrid from '../components/VariantCardGrid.vue'
import {
  trackGuardrailBlocked,
  createDiskSpaceChecker,
  showPathIssueAlerts,
  checkNvidiaDriverOrWarn,
  checkDiskSpaceOrWarn
} from '../lib/installHelpers'
import InstallNamePath from '../components/InstallNamePath.vue'
import TakeoverHeader from '../components/TakeoverHeader.vue'
import TakeoverBack from '../components/TakeoverBack.vue'
import ModalShell from '../components/ModalShell.vue'

const emit = defineEmits<{
  close: []
  'show-progress': [opts: ShowProgressOpts]
}>()

const { t } = useI18n()
const modal = useModal()

const source = ref<Source | null>(null)
const detectedGpu = ref('')
const variantOptions = ref<FieldOption[]>([])
const selectedVariant = ref<FieldOption | null>(null)
const releaseSelection = ref<FieldOption | null>(null)
const loading = ref(true)
const installing = ref(false)
const errorMessage = ref('')
const instName = ref('')
const instPath = ref('')
const defaultInstPath = ref('')
const {
  diskSpace,
  diskSpaceLoading,
  pathIssues,
  fetchDiskSpace,
  reset: resetDiskSpace
} = createDiskSpaceChecker()

const estimatedInstallSize = computed(() => {
  const files = selectedVariant.value?.data?.downloadFiles as Array<{ size: number }> | undefined
  const downloadBytes = files ? files.reduce((sum, f) => sum + f.size, 0) : 0
  return downloadBytes > 0 ? Math.ceil(downloadBytes * 2.25) : 0
})

const canInstall = computed(
  () =>
    !loading.value &&
    !installing.value &&
    selectedVariant.value !== null &&
    pathIssues.value.length === 0
)

watch(instPath, (newPath) => {
  diskSpace.value = null
  pathIssues.value = []
  fetchDiskSpace(newPath)
})

async function handleBrowse(): Promise<void> {
  const chosen = await window.api.browseFolder(instPath.value)
  if (chosen) instPath.value = chosen
}

function handleOpenPath(): void {
  if (instPath.value) void window.api.openPath(instPath.value)
}

/** Deep-strip Vue reactive proxies for safe IPC serialization */
function rawSelections(): Record<string, FieldOption> {
  const result: Record<string, FieldOption> = {}
  if (releaseSelection.value) {
    result.release = JSON.parse(JSON.stringify(toRaw(releaseSelection.value))) as FieldOption
  }
  if (selectedVariant.value) {
    result.variant = JSON.parse(JSON.stringify(toRaw(selectedVariant.value))) as FieldOption
  }
  return result
}

let installDirPromise: Promise<string> | null = null

onMounted(() => {
  installDirPromise = window.api.getDefaultInstallDir().catch(() => '')
})

async function open(): Promise<void> {
  loading.value = true
  installing.value = false
  errorMessage.value = ''
  variantOptions.value = []
  selectedVariant.value = null
  releaseSelection.value = null
  source.value = null
  instName.value = ''
  resetDiskSpace()

  detectedGpu.value = t('newInstall.detectingGpu')

  try {
    const [sources, gpu, defaultDir, hw] = await Promise.all([
      window.api.getSources(),
      window.api.detectGPU().catch(() => null),
      installDirPromise ?? window.api.getDefaultInstallDir().catch(() => ''),
      window.api.validateHardware()
    ])

    if (!hw.supported) {
      trackGuardrailBlocked('unsupported_hw', 'quick', 'open')
      await modal.alert({
        title: t('newInstall.unsupportedHardwareTitle'),
        message: hw.error || ''
      })
      emit('close')
      return
    }

    defaultInstPath.value = defaultDir ?? ''
    instPath.value = defaultInstPath.value

    if (gpu) {
      detectedGpu.value = t('newInstall.detectedGpu', { label: gpu.label })
    } else {
      detectedGpu.value = t('newInstall.noGpuDetected')
    }

    const standalone = sources.find((s) => s.id === 'standalone')
    if (!standalone) {
      errorMessage.value = t('newInstall.noOptions')
      loading.value = false
      return
    }
    source.value = standalone
    emitTelemetryAction('comfy.desktop.install.method.selected', {
      source_id: standalone.id,
      source_category: standalone.category || standalone.id,
      flow: 'quick'
    })

    // Load releases and auto-select latest
    const releases = await window.api.getFieldOptions(
      'standalone',
      'release',
      {},
      { includeLatestStable: true }
    )
    if (releases.length === 0) {
      errorMessage.value = t('newInstall.noOptions')
      loading.value = false
      return
    }
    releaseSelection.value = releases[0]!

    // Load variants for the selected release
    const variants = await window.api.getFieldOptions('standalone', 'variant', {
      release: JSON.parse(JSON.stringify(toRaw(releaseSelection.value))) as FieldOption
    })
    variantOptions.value = variants

    // Auto-select recommended variant
    const recommended = variants.find((v) => v.recommended)
    selectedVariant.value = recommended ?? variants[0] ?? null

    loading.value = false
  } catch (err: unknown) {
    errorMessage.value = (err as Error).message || String(err)
    loading.value = false
  }
}

function selectVariant(option: FieldOption): void {
  selectedVariant.value = option
  emitTelemetryAction('comfy.desktop.install.variant.selected', {
    variant_bucket: toVariantBucket((option.data?.variantId as string | undefined) || option.value),
    recommended: !!option.recommended,
    flow: 'quick'
  })
}

async function handleInstall(): Promise<void> {
  if (!source.value || !selectedVariant.value) return
  installing.value = true

  try {
    // Warn if NVIDIA driver is too old for the bundled PyTorch
    const variantId = selectedVariant.value.data?.variantId as string | undefined
    if (variantId && stripVariantPrefix(variantId).startsWith('nvidia')) {
      if (!(await checkNvidiaDriverOrWarn('quick', 'install', modal.confirm, t))) {
        installing.value = false
        return
      }
    }

    // Validate install path
    if (instPath.value) {
      try {
        const issues = await window.api.validateInstallPath(instPath.value)
        if (!(await showPathIssueAlerts(issues, 'quick', 'install', modal.alert, t))) {
          installing.value = false
          return
        }
      } catch {
        // If validation fails, proceed anyway
      }
    }

    // Check disk space
    if (instPath.value) {
      try {
        const downloadFiles = selectedVariant.value.data?.downloadFiles as
          | Array<{ size: number }>
          | undefined
        const downloadBytes = downloadFiles ? downloadFiles.reduce((sum, f) => sum + f.size, 0) : 0
        const estimatedRequired = downloadBytes > 0 ? downloadBytes * 2 : 0

        if (
          !(await checkDiskSpaceOrWarn({
            path: instPath.value,
            estimatedRequired,
            flow: 'quick',
            confirm: modal.confirm,
            t
          }))
        ) {
          installing.value = false
          return
        }
      } catch {
        // If disk space check fails, proceed anyway
      }
    }

    const instData = await window.api.buildInstallation('standalone', rawSelections())
    const baseName = instName.value.trim() || DEFAULT_INSTALL_NAME
    const name = await window.api.getUniqueName(baseName)

    const result = await window.api.addInstallation({
      name,
      installPath: instPath.value,
      ...instData,
      status: 'installing'
    })

    if (!result.ok) {
      await modal.alert({
        title: t('errors.cannotAdd'),
        message: result.message || ''
      })
      installing.value = false
      return
    }

    emit('close')
    if (result.entry) {
      emit('show-progress', {
        installationId: result.entry.id,
        title: `${t('newInstall.installing')} — ${result.entry.name}`,
        apiCall: () => window.api.installInstance(result.entry!.id),
        autoLaunchOnFinish: true,
        opKind: 'install'
      })
    }
  } catch (err: unknown) {
    await modal.alert({
      title: t('errors.installFailed'),
      message: (err as Error).message || String(err)
    })
    installing.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <ModalShell binding content-class="max-w-[620px]" @close="emit('close')">
    <template #header>
      <div class="flex min-w-0 flex-auto flex-col items-start gap-3 [&_.takeover-header]:w-full">
        <TakeoverBack :label="$t('common.backToDashboard')" @back="emit('close')" />
        <TakeoverHeader
          :title="$t('quickInstall.grandTitle')"
          :subtitle="$t('quickInstall.grandSubtitle')"
        />
      </div>
    </template>
    <div class="quick-install-scroll min-h-0 flex-1 overflow-y-auto pr-2">
      <div
        v-if="loading"
        class="quick-install-status flex items-center gap-2.5 py-3 text-[14px] text-text-muted before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
      >
        {{ $t('newInstall.loading') }}
      </div>

      <div v-else-if="errorMessage" class="quick-install-status py-3 text-[14px] text-text-muted">
        {{ errorMessage }}
      </div>

      <template v-else>
        <p class="quick-install-description mb-4 text-[14px] text-text-muted">
          {{ $t('quickInstall.desc') }}
        </p>

        <div
          class="quick-install-hardware mb-4 rounded-md border border-solid border-[var(--border)] bg-surface px-3 py-2 text-[13px] text-text-muted empty:hidden"
        >
          {{ detectedGpu }}
        </div>

        <div class="quick-install-field mt-4 flex flex-col">
          <label class="text-[14px] text-text-muted">{{ $t('quickInstall.selectVariant') }}</label>
          <VariantCardGrid
            :options="sortedCardOptions(variantOptions)"
            :selected-value="selectedVariant?.value"
            @select="selectVariant"
          />
        </div>

        <InstallNamePath
          :name="instName"
          :path="instPath"
          :default-path="defaultInstPath"
          :path-issues="pathIssues"
          :disk-space-loading="diskSpaceLoading"
          :disk-space="diskSpace"
          :estimated-size="estimatedInstallSize"
          @update:name="instName = $event"
          @update:path="instPath = $event"
          @browse="handleBrowse"
          @open="handleOpenPath"
        />
      </template>
    </div>

    <div
      class="quick-install-footer grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 pt-4 [&>:last-child]:justify-self-end"
    >
      <div></div>
      <div></div>
      <Button
        variant="inverted"
        size="unset"
        class="quick-install-button static inline-block rounded-lg border border-solid border-[var(--accent-primary)] bg-[var(--accent-primary)] px-8 py-2.5 text-[14px] leading-[1.5] font-medium whitespace-normal text-[var(--color-background)] appearance-auto transition-none hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] enabled:hover:border-[var(--accent-hover)] enabled:hover:bg-[var(--accent-hover)] hover:[transition:background_120ms_ease,border-color_120ms_ease] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] data-[installing=true]:pointer-events-none data-[installing=true]:opacity-70 data-[installing=true]:disabled:opacity-70 data-[installing=true]:after:ml-1.5 data-[installing=true]:after:inline-block data-[installing=true]:after:size-3 data-[installing=true]:after:animate-spin data-[installing=true]:after:rounded-[50%] data-[installing=true]:after:border-2 data-[installing=true]:after:border-solid data-[installing=true]:after:border-[var(--text-faint)] data-[installing=true]:after:border-t-[var(--accent)] data-[installing=true]:after:align-middle data-[installing=true]:after:[animation-duration:0.6s] data-[installing=true]:after:content-['']"
        :data-installing="installing"
        :disabled="!canInstall"
        @click="handleInstall"
      >
        {{ installing ? $t('newInstall.installing') : $t('quickInstall.confirmInstall') }}
      </Button>
    </div>
  </ModalShell>
</template>
