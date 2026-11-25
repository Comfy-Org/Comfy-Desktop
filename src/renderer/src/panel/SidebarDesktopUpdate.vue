<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleArrowUp } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tooltip from '../components/ui/Tooltip.vue'
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

const needsAction = computed(
  () =>
    state.value.kind === 'ready' || (state.value.kind === 'available' && !state.value.autoUpdate)
)

const tooltip = computed(() => {
  const { kind, version, autoUpdate } = state.value
  if (!version) {
    return kind === 'ready'
      ? t('titleBar.desktopUpdateReady')
      : t('titleBar.desktopUpdateAvailable')
  }
  if (kind !== 'ready') return t('titleBar.desktopUpdateAvailableTooltip', { version })
  return autoUpdate
    ? t('titleBar.desktopUpdateReadyTooltip', { version })
    : t('titleBar.desktopUpdateReadyManualTooltip', { version })
})

function reportActionFailure(err: unknown): void {
  console.error('SidebarDesktopUpdate: update action failed', err)
}

function onClick(): void {
  const { kind, version } = state.value
  if (kind === 'ready') showAppUpdateRestartPrompt(version).catch(reportActionFailure)
  else showAppUpdateDownloadPrompt(version).catch(reportActionFailure)
}
</script>

<template>
  <Tooltip
    v-if="needsAction"
    :text="tooltip"
    :side="collapsed ? 'right' : 'top'"
    class="shrink-0 transition-[width,margin] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
    :class="collapsed ? 'ml-1 w-8 duration-300' : 'mb-1 w-full duration-260'"
  >
    <Button
      variant="textonly"
      size="unset"
      class="h-8 w-full gap-1 rounded-full bg-azure-600 text-[13px]/5 font-medium text-white hover:bg-azure-600/85"
      :aria-label="tooltip"
      :data-state="state.kind"
      data-testid="app-sidebar-desktop-update"
      @click="onClick"
    >
      <CircleArrowUp :size="collapsed ? 15 : 13" class="shrink-0" aria-hidden="true" />
      <Transition
        enter-active-class="transition-opacity duration-180 delay-30 ease-out"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-150 ease-out"
        leave-to-class="opacity-0"
      >
        <span v-if="!collapsed" class="text-nowrap">{{ t('titleBar.desktopUpdateButton') }}</span>
      </Transition>
    </Button>
  </Tooltip>
</template>
