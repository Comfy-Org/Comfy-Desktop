<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/sessionStore'

import { useTerminalScroll } from '../composables/useTerminalScroll'

interface Props {
  installationId: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const sessionStore = useSessionStore()

const api = window.api

const session = computed(() => {
  if (!props.installationId) return undefined
  return sessionStore.getSession(props.installationId)
})

const runningInfo = computed(() => {
  if (!props.installationId) return undefined
  return sessionStore.runningInstances.get(props.installationId)
})

const errorInfo = computed(() => {
  if (!props.installationId) return undefined
  return sessionStore.errorInstances.get(props.installationId)
})

const isStopping = computed(() => {
  if (!props.installationId) return false
  return sessionStore.isStopping(props.installationId)
})

const isExited = computed(() => {
  return session.value ? session.value.exited : true
})

const title = computed(() => {
  const instName = runningInfo.value?.installationName || errorInfo.value?.installationName
  return instName ? `${t('console.title')} — ${instName}` : t('console.title')
})

const showWindowBtn = computed(() => {
  return runningInfo.value && runningInfo.value.mode !== 'console'
})

const comfyUrl = computed(() => {
  if (!runningInfo.value) return null
  return runningInfo.value.url || `http://127.0.0.1:${runningInfo.value.port || 8188}`
})

const terminalOutput = computed(() => {
  return session.value?.output ?? ''
})

const terminalRef = ref<HTMLDivElement | null>(null)
const { isAtBottom, terminalExpanded, handleTerminalScroll, scrollToBottom } = useTerminalScroll(
  terminalRef,
  () => terminalOutput.value
)

watch(
  () => props.installationId,
  async () => {
    isAtBottom.value = true
    terminalExpanded.value = true
    await nextTick()
    scrollToBottom()
  }
)
</script>

<template>
  <div
    v-if="installationId"
    class="view-modal-content mx-[30px] flex h-[calc(100vh-60px)] w-full max-w-[900px] flex-col overflow-hidden rounded-xl border border-solid border-[var(--border)] bg-[var(--bg)] [.view-fullscreen_&]:h-full [.view-fullscreen_&]:max-w-none [.view-fullscreen_&]:rounded-none [.view-fullscreen_&]:border-none"
  >
    <div
      class="view-modal-header flex shrink-0 items-center gap-3 border-b border-solid border-[var(--border)] px-5 py-4"
    >
      <div
        class="view-modal-title flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-[18px] font-semibold text-text"
      >
        {{ title }}
      </div>
      <Button
        type="button"
        variant="muted-textonly"
        size="icon"
        class="view-modal-close shrink-0"
        :aria-label="t('common.close')"
        @click="emit('close')"
      >
        {{ !isExited && !errorInfo ? '−' : '✕' }}
      </Button>
    </div>
    <div class="view-modal-body flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <div
        v-if="errorInfo?.message"
        class="console-error-message max-h-1/2 shrink-0 overflow-y-auto px-3 py-2.5 text-[14px] whitespace-pre-wrap text-[var(--danger)] select-text"
      >
        {{ errorInfo.message }}
      </div>
      <Button
        variant="muted-textonly"
        size="md"
        type="button"
        class="terminal-toggle self-start"
        :aria-expanded="terminalExpanded"
        @click="terminalExpanded = !terminalExpanded"
      >
        <span class="terminal-toggle-icon text-[18px]">{{ terminalExpanded ? '▾' : '▸' }}</span>
        <span>{{ $t('list.console') }}</span>
      </Button>
      <div
        v-show="terminalExpanded"
        id="console-terminal"
        ref="terminalRef"
        class="terminal-output min-h-0 max-h-none flex-1 overflow-y-auto rounded-md border border-solid border-[var(--border)] bg-[var(--terminal-bg)] px-3 py-2.5 text-[13px] whitespace-pre-wrap text-text-muted select-text [font-family:'Cascadia_Mono','Consolas',monospace] [word-break:break-all]"
        @scroll="handleTerminalScroll"
      >
        {{ terminalOutput }}
      </div>
    </div>

    <!-- Bottom bar (pinned outside scrollable body) -->
    <div class="view-modal-footer shrink-0 border-t border-solid border-[var(--border)] px-5 py-3">
      <div class="console-actions flex shrink-0 justify-end gap-2.5 pt-0">
        <Button
          v-if="showWindowBtn"
          type="button"
          variant="outline"
          size="lg"
          class="console-action--show"
          @click="api.focusComfyWindow(installationId!)"
        >
          {{ $t('running.showWindow') }}
        </Button>
        <Button
          v-if="comfyUrl && runningInfo?.mode === 'console'"
          type="button"
          variant="secondary"
          size="lg"
          class="console-action--browser"
          @click="api.openPath(comfyUrl)"
        >
          {{ $t('console.openInBrowser') }}
        </Button>
        <Button
          v-if="isStopping"
          type="button"
          variant="destructive"
          size="lg"
          class="console-action--stop"
          disabled
        >
          {{ $t('console.stopping') }}
        </Button>
        <Button
          v-else-if="!isExited && !errorInfo"
          type="button"
          variant="destructive"
          size="lg"
          class="console-action--stop"
          @click="api.stopComfyUI(installationId!)"
        >
          {{ $t('console.stop') }}
        </Button>
        <Button
          v-if="errorInfo"
          type="button"
          variant="secondary"
          size="lg"
          class="console-action--dismiss"
          @click="(sessionStore.clearErrorInstance(installationId!), emit('close'))"
        >
          {{ $t('running.dismiss') }}
        </Button>
      </div>
    </div>
  </div>
</template>
