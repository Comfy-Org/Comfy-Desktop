<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Square } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import { useDialogs } from '../../composables/useDialogs'
import { useSessionStore } from '../../stores/sessionStore'
import { installationIdOf, sessionKindOf } from '../../../../shared/performanceTestSession'
import type { BlockingSession } from '../../types/ipc'

const props = defineProps<{
  sessions: BlockingSession[]
}>()

const { t } = useI18n()
const dialogs = useDialogs()
const sessionStore = useSessionStore()
const requestedStops = ref<ReadonlySet<string>>(new Set())

function isPreparingLaunch(sessionId: string): boolean {
  const installationId = installationIdOf(sessionId)
  const operation = sessionStore.operationInstances.get(installationId)
  return operation?.actionId === 'launch' && (operation.sessionId ?? installationId) === sessionId
}

const rows = computed(() =>
  props.sessions.map(({ sessionId, name }) => {
    const stopping = sessionStore.isStopping(sessionId) || requestedStops.value.has(sessionId)
    const active =
      sessionStore.isRunning(sessionId) ||
      sessionStore.isLaunching(sessionId) ||
      isPreparingLaunch(sessionId)
    return {
      sessionId,
      label:
        sessionKindOf(sessionId) === 'performance_test'
          ? t('launch.instanceRunningPerformanceTest', { name })
          : name,
      state: stopping ? 'stopping' : active ? 'active' : 'stopped'
    }
  })
)

async function stopSession(sessionId: string): Promise<void> {
  const confirmed = await dialogs.confirm({
    title: t('actions.stopConfirmTitle'),
    message: t('actions.stopConfirmMessage'),
    confirmLabel: t('actions.stop'),
    tone: 'danger'
  })
  if (!confirmed) return
  requestedStops.value = new Set([...requestedStops.value, sessionId])
  try {
    await window.api.cancelOperation(sessionId)
    await window.api.stopComfyUI(sessionId)
    await window.api.closeComfyWindow(sessionId, { skipConfirm: true, keepDesktopOpen: true })
  } catch (error) {
    console.error('Failed to stop the build blocking the performance test:', error)
  } finally {
    requestedStops.value = new Set([...requestedStops.value].filter((id) => id !== sessionId))
  }
}
</script>

<template>
  <ul
    class="performance-test__blocking-builds m-0 mt-3 flex list-none flex-col overflow-hidden rounded-lg p-0"
  >
    <li
      v-for="row in rows"
      :key="row.sessionId"
      class="performance-test__blocking-build flex min-h-10 items-center gap-3 py-1.5 pr-1.5 pl-3 odd:bg-white/[0.06] even:bg-white/[0.02]"
    >
      <span class="min-w-0 truncate text-foreground" :title="row.label">{{ row.label }}</span>
      <span
        v-if="row.state === 'stopped'"
        class="performance-test__blocking-build-stopped ml-auto shrink-0 pr-1.5 text-[12px]"
      >
        {{ t('performanceTest.blockingBuildStopped') }}
      </span>
      <Button
        v-else
        class="performance-test__blocking-build-stop ml-auto h-7 shrink-0 gap-1.5 rounded-md px-2.5 text-[12px]"
        variant="secondary"
        size="unset"
        type="button"
        :disabled="row.state === 'stopping'"
        @click="stopSession(row.sessionId)"
      >
        <Square :size="11" fill="currentColor" aria-hidden="true" />
        {{ row.state === 'stopping' ? t('performanceTest.stopping') : t('performanceTest.stop') }}
      </Button>
    </li>
  </ul>
</template>
