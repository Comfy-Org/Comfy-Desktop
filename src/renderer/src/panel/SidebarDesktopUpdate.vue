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

function reportActionFailure(err: unknown): void {
  console.error('SidebarDesktopUpdate: update action failed', err)
}

function onClick(): void {
  const { kind, version } = state.value
  if (kind === 'available') showAppUpdateDownloadPrompt(version).catch(reportActionFailure)
  else if (kind === 'ready') showAppUpdateRestartPrompt(version).catch(reportActionFailure)
  else if (kind === 'downloading') window.api.openGlobalSettings('updates')
}
</script>

<template>
  <Button
    v-if="state.kind"
    variant="textonly"
    size="unset"
    class="h-8 shrink-0 justify-start gap-2.5 rounded-lg text-[13px]/5 font-normal text-azure-600 hover:bg-secondary transition-[width,margin,padding,background-color,color] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
    :class="collapsed ? 'ml-1 w-8 pr-0 pl-2 duration-300' : 'ml-0 w-full px-3 duration-260'"
    :aria-label="tooltip"
    :title="tooltip"
    :data-state="state.kind"
    data-testid="app-sidebar-desktop-update"
    @click="onClick"
  >
    <component
      :is="icon"
      :size="15"
      class="shrink-0"
      :class="
        state.kind === 'downloading' &&
        'animate-spin [animation-duration:900ms] motion-reduce:animate-none'
      "
      aria-hidden="true"
    />
    <Transition
      enter-active-class="transition-opacity duration-180 delay-30 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150 ease-out"
      leave-to-class="opacity-0"
    >
      <span v-if="!collapsed" class="min-w-0 flex-1 overflow-hidden text-left text-nowrap">{{
        label
      }}</span>
    </Transition>
  </Button>
</template>
