<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsSectionList from '../../views/comfyUISettings/SettingsSectionList.vue'
import { formatRelativeFromMs } from '../../lib/datetime'
import { formatBytes, formatSpeed } from '../../lib/downloadFormatters'
import type {
  AppUpdateDownloadProgress,
  AppUpdateState,
  DetailField,
  DetailSection
} from '../../types/ipc'

interface Props {
  state: AppUpdateState
  progress: AppUpdateDownloadProgress | null
  isDownloading: boolean
  checking: boolean
  lastCheckedAt: number | null
  installedVersion: string
  systemManaged?: boolean
  preferenceFields?: DetailField[]
}

const props = withDefaults(defineProps<Props>(), {
  systemManaged: false,
  preferenceFields: () => []
})

const emit = defineEmits<{
  'update-now': []
  'check-for-update': []
  'update-field': [field: DetailField, value: unknown]
  'open-path': [path: string]
}>()

const { t, d } = useI18n()

function formatVersionLabel(raw: string | undefined | null): string {
  if (!raw) return '—'
  const trimmed = raw.trim()
  if (trimmed.startsWith('v') || trimmed.startsWith('V')) return trimmed
  return `v${trimmed}`
}

function normalizeVersion(raw: string | undefined | null): string {
  if (!raw) return ''
  return raw.trim().replace(/^[vV]/, '').toLowerCase()
}

const targetVersionLabel = computed(() => {
  if (props.state.version) return formatVersionLabel(props.state.version)
  return t('appUpdate.fallbackVersion', 'this update')
})

const statusSentence = computed(() => {
  if (props.isDownloading || props.state.kind === 'downloading') {
    return t(
      'appUpdate.panelDownloadingTitle',
      {
        version: targetVersionLabel.value
      },
      'Downloading update…'
    )
  }
  switch (props.state.kind) {
    case 'ready':
      return t(
        'appUpdate.panelReadyTitle',
        {
          version: targetVersionLabel.value
        },
        'Update ready to install'
      )
    case 'available':
      return t(
        'appUpdate.panelAvailableTitle',
        {
          version: targetVersionLabel.value
        },
        'Update available'
      )
    default:
      return t('appUpdate.panelIdleTitle', 'Comfy Desktop is up to date')
  }
})

const statusTone = computed(() => {
  if (props.isDownloading || props.state.kind === 'downloading') return 'downloading'
  if (props.state.kind === 'available' || props.state.kind === 'ready') return 'update'
  return 'current'
})

const installedDetail = computed(() => {
  if (!props.installedVersion) return null
  return t(
    'appUpdate.installedLabel',
    { version: formatVersionLabel(props.installedVersion) },
    `Installed ${formatVersionLabel(props.installedVersion)}`
  )
})

const lastCheckedDetail = computed(() => {
  if (!props.lastCheckedAt) return null
  let title: string | undefined
  try {
    title = d(new Date(props.lastCheckedAt), 'long')
  } catch {
    title = new Date(props.lastCheckedAt).toLocaleString()
  }
  const time = formatRelativeFromMs(props.lastCheckedAt, t)
  return {
    text: t('appUpdate.lastCheckedLabel', { time }, `Last checked ${time}`),
    title
  }
})

const latestDetail = computed(() => {
  if (!props.state.version) return null
  const installed = normalizeVersion(props.installedVersion)
  const latest = normalizeVersion(props.state.version)
  if (!latest || installed === latest) return null
  return t(
    'appUpdate.latestLabel',
    { version: formatVersionLabel(props.state.version) },
    `Latest ${formatVersionLabel(props.state.version)}`
  )
})

const preferenceSections = computed<DetailSection[]>(() =>
  props.preferenceFields.length > 0 ? [{ fields: props.preferenceFields }] : []
)

const primaryActionLabel = computed(() => {
  if (props.checking) return t('settings.checkingForUpdates', 'Checking…')
  if (props.isDownloading) return t('appUpdate.downloading', 'Downloading…')
  switch (props.state.kind) {
    case 'ready':
      return t('appUpdate.restartNow', 'Restart & update')
    case 'available':
      return t('appUpdate.download', 'Download')
    default:
      return t('settings.checkForUpdates', 'Check for updates')
  }
})

const showSecondaryCheck = computed(
  () => props.state.kind === 'available' || props.state.kind === 'ready'
)

const actionsDisabled = computed(() => props.checking || props.isDownloading)

const percent = computed<number | null>(() => {
  const p = props.progress?.percent
  if (typeof p !== 'number') return null
  return Math.max(0, Math.min(100, Math.round(p)))
})

const progressDetail = computed<string | null>(() => {
  const p = props.progress
  if (!p) return null
  const parts: string[] = []
  if (p.transferred !== null && p.total !== null) {
    parts.push(`${formatBytes(p.transferred)} / ${formatBytes(p.total)}`)
  }
  if (p.bytesPerSecond !== null && p.bytesPerSecond > 0) {
    parts.push(formatSpeed(p.bytesPerSecond))
  }
  return parts.length > 0 ? parts.join(' · ') : null
})
</script>

<template>
  <div class="updates-section flex flex-col gap-3">
    <div
      class="updates-card overflow-hidden rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)]"
    >
      <div class="updates-card-body flex flex-col gap-2 px-3.5 pt-3.5 pb-3">
        <p
          class="updates-status m-0 text-[14px] leading-5 font-semibold"
          :class="[
            statusTone,
            statusTone === 'downloading'
              ? 'text-[var(--accent-primary,#0b8ce9)]'
              : statusTone === 'update'
                ? 'text-[var(--accent)]'
                : 'text-neutral-100'
          ]"
        >
          {{ statusSentence }}
        </p>

        <div
          v-if="installedDetail || lastCheckedDetail || latestDetail"
          class="updates-details flex flex-col gap-0.5"
        >
          <span
            v-if="installedDetail"
            class="updates-detail text-[12px] leading-[17px] text-text-muted [&.is-highlight]:font-medium [&.is-highlight]:text-[var(--accent)]"
            >{{ installedDetail }}</span
          >
          <span
            v-if="lastCheckedDetail"
            class="updates-detail text-[12px] leading-[17px] text-text-muted [&.is-highlight]:font-medium [&.is-highlight]:text-[var(--accent)]"
            :title="lastCheckedDetail.title"
            >{{ lastCheckedDetail.text }}</span
          >
          <span
            v-if="latestDetail"
            class="updates-detail is-highlight text-[12px] leading-[17px] text-text-muted [&.is-highlight]:font-medium [&.is-highlight]:text-[var(--accent)]"
            >{{ latestDetail }}</span
          >
        </div>

        <p
          v-if="systemManaged"
          class="updates-note m-0 text-[11px] leading-4 text-text-muted opacity-85"
        >
          {{
            t(
              'appUpdate.systemManagedNote',
              'Updates for this install are delivered through your system package manager.'
            )
          }}
        </p>

        <div v-if="isDownloading" class="updates-progress flex flex-col gap-1 pt-1">
          <div
            class="updates-progress-track relative mb-4 h-1 w-full overflow-hidden rounded-[9999px]"
            :class="
              percent === null
                ? 'indeterminate bg-[linear-gradient(90deg,color-mix(in_oklab,var(--neutral-100)_6%,transparent)_0%,var(--accent-primary,#0b8ce9)_50%,color-mix(in_oklab,var(--neutral-100)_6%,transparent)_100%)] [background-size:200%_100%] animate-[progress-indeterminate_1.4s_linear_infinite]'
                : 'bg-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)]'
            "
          >
            <div
              v-if="percent !== null"
              class="updates-progress-fill absolute inset-y-0 left-0 h-full rounded bg-[var(--accent-primary,#0b8ce9)] transition-[width] duration-[120ms] ease-[ease]"
              :style="{ width: percent + '%' }"
            ></div>
          </div>
          <div class="updates-progress-detail flex justify-between text-[11px] text-text-muted">
            <span v-if="percent !== null">{{ percent }}%</span>
            <span v-if="progressDetail">{{ progressDetail }}</span>
          </div>
        </div>
      </div>

      <div
        class="updates-card-footer flex flex-wrap items-center justify-end gap-2 border-t border-solid border-[var(--border-hover)] px-3.5 pt-2.5 pb-3"
      >
        <button
          v-if="showSecondaryCheck"
          type="button"
          class="updates-action inline-flex h-8 min-h-8 flex-none box-border items-center justify-center rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-4 py-0 text-[13px] leading-none font-medium whitespace-nowrap text-neutral-100 cursor-pointer transition-[background-color] duration-100 ease-[ease] enabled:hover:bg-[var(--brand-surface-bg-hover)] enabled:hover:outline-none enabled:focus-visible:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed [&.updates-action--accent]:border-[var(--accent)] [&.updates-action--accent]:font-semibold [&.updates-action--accent]:text-[var(--accent)]"
          :disabled="actionsDisabled"
          @click="emit('check-for-update')"
        >
          {{ t('settings.checkForUpdates', 'Check for updates') }}
        </button>
        <button
          type="button"
          class="updates-action updates-action--accent inline-flex h-8 min-h-8 flex-none box-border items-center justify-center rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-4 py-0 text-[13px] leading-none font-medium whitespace-nowrap text-neutral-100 cursor-pointer transition-[background-color] duration-100 ease-[ease] enabled:hover:bg-[var(--brand-surface-bg-hover)] enabled:hover:outline-none enabled:focus-visible:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed [&.updates-action--accent]:border-[var(--accent)] [&.updates-action--accent]:font-semibold [&.updates-action--accent]:text-[var(--accent)] disabled:hover:bg-[var(--brand-surface-bg-hover)]"
          :disabled="actionsDisabled"
          @click="emit('update-now')"
        >
          {{ primaryActionLabel }}
        </button>
      </div>
    </div>

    <SettingsSectionList
      v-if="preferenceSections.length > 0"
      :sections="preferenceSections"
      @update-field="(field, value) => emit('update-field', field, value)"
      @open-path="(path) => emit('open-path', path)"
    />
  </div>
</template>

<style>
@keyframes progress-indeterminate {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
