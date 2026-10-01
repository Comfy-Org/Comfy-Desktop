<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { FlaskConical, LoaderCircle } from 'lucide-vue-next'
import BaseMenu, { type BaseMenuItem } from '../../components/ui/BaseMenu.vue'
import { BETA_FEATURES_FIELD_ID } from '../../comfyTitleBar/useBetaActivationNotice'
import { useSessionStore } from '../../stores/sessionStore'
import type { CoreBetaArgs } from '../../types/ipc'
import { SETTINGS_REOPEN_EPOCH } from './settingsReopenEpoch'

/** "+N beta": the running session's Core beta args, or while stopped those the next launch is
 *  eligible for. Fetches its own data while mounted, so nothing else in the view waits on it. */

const props = defineProps<{
  installationId: string
  argsValue: string
  /** Bumped when the args field's schema load settles; the preview reads that cache. */
  schemaVersion: number
}>()

const LOADING_DELAY_MS = 150
const OPT_IN_KEYS = new Set(['betaFeaturesEnabled', 'telemetryEnabled'])

const { t } = useI18n()
const sessionStore = useSessionStore()
const menu = useTemplateRef<InstanceType<typeof BaseMenu>>('menu')

const data = ref<CoreBetaArgs | null>(null)
const loading = ref(false)
let requestSeq = 0

// Keyed on start time too: a restart can reach a hidden picker as running -> running.
const sessionKey = computed(() => {
  const running = sessionStore.runningInstances.get(props.installationId)
  return running ? `running:${running.startedAt ?? ''}` : 'stopped'
})

async function refresh(): Promise<void> {
  const seq = ++requestSeq
  const slow = setTimeout(() => {
    if (seq === requestSeq) loading.value = true
  }, LOADING_DELAY_MS)
  const next = await window.api
    .getCoreBetaArgs(props.installationId, props.argsValue)
    .catch(() => null)
  clearTimeout(slow)
  if (seq !== requestSeq) return
  data.value = next
  loading.value = false
}

const reopenEpoch = inject(SETTINGS_REOPEN_EPOCH, null)

watch(
  () => [
    props.installationId,
    sessionKey.value,
    props.argsValue,
    props.schemaVersion,
    reopenEpoch?.value
  ],
  () => void refresh(),
  { immediate: true }
)
const offSettings = window.api.onSettingsChanged?.(({ key }) => {
  if (OPT_IN_KEYS.has(key)) void refresh()
})
onBeforeUnmount(() => offSettings?.())
// A click in another WebContents never reaches this document's pointer listener.
useEventListener(window, 'blur', () => menu.value?.close(false))

const args = computed(() => data.value?.args ?? [])
const next = computed(() => data.value?.timing === 'next-launch')
const items = computed<BaseMenuItem[]>(() => [
  ...args.value.map((view) => ({
    id: `arg:${view.arg}`,
    label: view.arg,
    detail: view.name ?? t('comfyUISettings.betaArgsUnnamed'),
    disabled: true
  })),
  { id: 'manage', label: t('comfyUISettings.betaArgsManage'), separator: true }
])

function onSelect(id: string): void {
  if (id === 'manage') {
    window.api.openGlobalSettings('general', { highlightField: BETA_FEATURES_FIELD_ID })
  }
}
</script>

<template>
  <span
    v-if="loading"
    class="beta-args beta-args-loading"
    role="status"
    :aria-label="t('comfyUISettings.betaArgsLoading')"
  >
    <LoaderCircle :size="12" class="beta-args-spin" aria-hidden="true" />
    <span>{{ t('comfyUISettings.betaArgsPillLoading') }}</span>
  </span>
  <span v-else-if="args.length > 0" class="beta-args">
    <BaseMenu
      ref="menu"
      :items="items"
      align="end"
      list-class="beta-args-menu"
      :heading="t(next ? 'comfyUISettings.betaArgsHeadingNext' : 'comfyUISettings.betaArgsHeading')"
      :trigger-aria-label="
        t(
          next ? 'comfyUISettings.betaArgsAriaLabelNext' : 'comfyUISettings.betaArgsAriaLabel',
          { n: args.length },
          args.length
        )
      "
      @select="onSelect"
    >
      <FlaskConical :size="12" class="beta-args-flask" aria-hidden="true" />
      <span>{{ t('comfyUISettings.betaArgsPill', { n: args.length }) }}</span>
    </BaseMenu>
  </span>
</template>

<style scoped>
/* Qualified by `.beta-args` to outrank BaseInput's `.ui-input-trailing :deep(button)` icon-button
 * sizing, which otherwise squeezes every trailing-slot button to 28x28. */
.beta-args {
  display: inline-flex;
  align-items: center;
}

.beta-args :deep(button.ui-menu-trigger),
.beta-args-loading {
  gap: 4px;
  width: auto;
  height: 22px;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 9999px;
}

.beta-args :deep(button.ui-menu-trigger:hover),
.beta-args :deep(button.ui-menu-trigger[aria-expanded='true']) {
  color: var(--text);
  background: var(--border-hover);
}

.beta-args-loading {
  opacity: 0.7;
}

.beta-args-flask {
  color: var(--accent-plum);
}

.beta-args-spin {
  animation: beta-args-spin 1s linear infinite;
}

@keyframes beta-args-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style>
/* The menu is teleported to <body>, out of reach of scoped styles. */
.beta-args-menu {
  width: 300px;
}

/* Arg rows are information, not actions: inert, but not greyed out. */
.beta-args-menu .ui-menu-item[aria-disabled='true'] {
  align-items: baseline;
  color: var(--text);
  font-size: 12px;
  cursor: default;
}

/* A flag is one token and never breaks; the feature name beside it wraps instead. */
.beta-args-menu .ui-menu-item[aria-disabled='true'] .ui-menu-item-label {
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
}
</style>
