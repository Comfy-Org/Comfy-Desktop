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

const label = computed(() =>
  state.value.kind === 'ready'
    ? t('titleBar.desktopUpdateRestartButton')
    : t('titleBar.desktopUpdateDesktopButton')
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
    :class="collapsed ? 'ml-1 w-8 duration-300' : 'ml-0 w-full duration-260'"
  >
    <Button
      variant="textonly"
      size="unset"
      class="h-8 w-full justify-start rounded-lg bg-update/15 px-0 text-[13px]/5 font-normal text-update-foreground hover:bg-update/25 transition-[background-color] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
      :aria-label="label"
      :aria-description="tooltip"
      :data-state="state.kind"
      data-testid="app-sidebar-desktop-update"
      @click="onClick"
    >
      <span
        class="flex size-full items-center gap-2.5 overflow-hidden transition-[padding] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
        :class="collapsed ? 'pr-0 pl-2 duration-300' : 'px-3 duration-260'"
      >
        <CircleArrowUp :size="15" class="shrink-0" aria-hidden="true" />
        <Transition
          enter-active-class="transition-opacity duration-180 delay-30 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-150 ease-out"
          leave-to-class="opacity-0"
        >
          <span v-if="!collapsed" class="flex min-w-0 flex-1 items-center gap-2 text-nowrap">
            <span class="min-w-0 flex-1 overflow-hidden text-left">{{ label }}</span>
            <span
              v-if="state.version"
              class="shrink-0 text-muted-foreground"
              data-testid="app-sidebar-desktop-update-version"
              >{{ t('titleBar.desktopUpdateVersion', { version: state.version }) }}</span
            >
          </span>
        </Transition>
      </span>
    </Button>
  </Tooltip>
</template>
