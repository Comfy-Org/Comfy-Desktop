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

// Match the scoped pill selector priority inside an input’s trailing slot.
const pillTriggerClass =
  '[&.beta-args_button.ui-menu-trigger]:gap-1 [&.beta-args_button.ui-menu-trigger]:w-auto [&.beta-args_button.ui-menu-trigger]:h-[22px] [&.beta-args_button.ui-menu-trigger]:px-[7px] [&.beta-args_button.ui-menu-trigger]:py-0 [&.beta-args_button.ui-menu-trigger]:text-[11px] [&.beta-args_button.ui-menu-trigger]:font-medium [&.beta-args_button.ui-menu-trigger]:whitespace-nowrap [&.beta-args_button.ui-menu-trigger]:text-text-muted [&.beta-args_button.ui-menu-trigger]:bg-transparent [&.beta-args_button.ui-menu-trigger]:border [&.beta-args_button.ui-menu-trigger]:border-solid [&.beta-args_button.ui-menu-trigger]:border-[var(--border)] [&.beta-args_button.ui-menu-trigger]:rounded-[9999px] [&.beta-args_button.ui-menu-trigger:hover]:text-text [&.beta-args_button.ui-menu-trigger:hover]:bg-border-hover [&.beta-args_button.ui-menu-trigger[aria-expanded=true]]:text-text [&.beta-args_button.ui-menu-trigger[aria-expanded=true]]:bg-border-hover'

const LOADING_DELAY_MS = 150
const OPT_IN_KEYS = new Set(['betaFeaturesEnabled', 'telemetryEnabled'])

const { t } = useI18n()
const sessionStore = useSessionStore()
const menu = useTemplateRef<InstanceType<typeof BaseMenu>>('menu')

const data = ref<CoreBetaArgs | null>(null)
const loading = ref(false)
let requestSeq = 0
let shownFor: string | null = null

// Keyed on start time too: a restart can reach a hidden picker as running -> running.
const sessionKey = computed(() => {
  const running = sessionStore.runningInstances.get(props.installationId)
  return running ? `running:${running.startedAt ?? ''}` : 'stopped'
})

async function refresh(): Promise<void> {
  const seq = ++requestSeq
  // Never show one install's args while another's are on the way.
  if (shownFor !== props.installationId) data.value = null
  shownFor = props.installationId
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
    class="beta-args beta-args-loading inline-flex h-[22px] w-auto items-center gap-1 rounded-[9999px] border border-solid border-[var(--border)] bg-transparent px-[7px] py-0 text-[11px] font-medium whitespace-nowrap text-text-muted opacity-70"
    role="status"
    :aria-label="t('comfyUISettings.betaArgsLoading')"
  >
    <LoaderCircle :size="12" class="beta-args-spin animate-spin" aria-hidden="true" />
    <span>{{ t('comfyUISettings.betaArgsPillLoading') }}</span>
  </span>
  <span
    v-else-if="args.length > 0"
    class="beta-args inline-flex items-center"
    :class="pillTriggerClass"
  >
    <BaseMenu
      ref="menu"
      :items="items"
      align="end"
      list-class="beta-args-menu w-[300px] [&_.ui-menu-item[aria-disabled=true]]:items-baseline [&_.ui-menu-item[aria-disabled=true]]:text-text [&_.ui-menu-item[aria-disabled=true]]:text-[12px] [&_.ui-menu-item[aria-disabled=true]]:cursor-default [&_.ui-menu-item[aria-disabled=true]_.ui-menu-item-label]:flex-none [&_.ui-menu-item[aria-disabled=true]_.ui-menu-item-label]:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] [&_.ui-menu-item[aria-disabled=true]_.ui-menu-item-label]:font-semibold"
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
      <FlaskConical
        :size="12"
        class="beta-args-flask text-[var(--accent-plum)]"
        aria-hidden="true"
      />
      <span>{{ t('comfyUISettings.betaArgsPill', { n: args.length }) }}</span>
    </BaseMenu>
  </span>
</template>
