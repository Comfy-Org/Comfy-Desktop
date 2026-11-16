<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudDownload, LoaderCircle, RefreshCw } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import { useAppUpdatePrompts } from '../composables/useAppUpdatePrompts'
import type { AppUpdateState } from '../types/ipc'

const { collapsed } = defineProps<{
  collapsed: boolean
}>()

const { t } = useI18n()
const { showAppUpdateDownloadPrompt, showAppUpdateRestartPrompt } = useAppUpdatePrompts()

const state = ref<AppUpdateState>({ kind: null, version: null, autoUpdate: true })
let unsubscribe: (() => void) | undefined
let heardChange = false

onMounted(() => {
  unsubscribe = window.api.onAppUpdateStateChanged((next) => {
    heardChange = true
    state.value = next
  })
  void window.api
    .getAppUpdateState()
    .then((current) => {
      if (!heardChange) state.value = current
    })
    .catch(() => {})
})

onUnmounted(() => unsubscribe?.())

const label = computed(() => {
  if (state.value.kind === 'ready') return t('titleBar.desktopUpdateReady')
  if (state.value.kind === 'downloading') return t('titleBar.desktopUpdateDownloading')
  return t('titleBar.desktopUpdateAvailable')
})

const tooltip = computed(() =>
  state.value.version
    ? t('titleBar.desktopUpdateWithVersion', { label: label.value, version: state.value.version })
    : label.value
)

const icon = computed(() => {
  if (state.value.kind === 'ready') return RefreshCw
  if (state.value.kind === 'downloading') return LoaderCircle
  return CloudDownload
})

function onClick(): void {
  const { kind, version } = state.value
  if (kind === 'available') void showAppUpdateDownloadPrompt(version)
  else if (kind === 'ready') void showAppUpdateRestartPrompt(version)
  else if (kind === 'downloading') window.api.openGlobalSettings('updates')
}
</script>

<template>
  <Button
    v-if="state.kind"
    variant="textonly"
    size="unset"
    class="h-8 w-full shrink-0 rounded-lg text-[13px]/5 font-normal text-azure-600 hover:bg-secondary"
    :class="collapsed ? 'justify-center px-0' : 'justify-start gap-2.5 px-3'"
    :aria-label="tooltip"
    :title="tooltip"
    :data-state="state.kind"
    data-testid="app-sidebar-desktop-update"
    @click="onClick"
  >
    <component
      :is="icon"
      :size="15"
      :class="
        state.kind === 'downloading' &&
        'animate-spin [animation-duration:900ms] motion-reduce:animate-none'
      "
      aria-hidden="true"
    />
    <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">{{ label }}</span>
  </Button>
</template>
