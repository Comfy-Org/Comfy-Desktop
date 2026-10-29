<script setup lang="ts">
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
      <button
        class="view-modal-close shrink-0 border-none bg-transparent px-2 py-1 text-[18px] leading-none text-text-muted cursor-pointer hover:bg-transparent hover:text-text"
        @click="emit('close')"
      >
        {{ !isExited && !errorInfo ? '−' : '✕' }}
      </button>
    </div>
    <div class="view-modal-body flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <div
        v-if="errorInfo?.message"
        class="console-error-message max-h-1/2 shrink-0 overflow-y-auto px-3 py-2.5 text-[14px] whitespace-pre-wrap text-[var(--danger)] select-text"
      >
        {{ errorInfo.message }}
      </div>
      <button
        type="button"
        class="terminal-toggle flex shrink-0 items-center gap-1.5 border-none bg-transparent p-1.5 text-[14px] text-text-muted select-none cursor-pointer hover:bg-transparent hover:text-text"
        :aria-expanded="terminalExpanded"
        @click="terminalExpanded = !terminalExpanded"
      >
        <span class="terminal-toggle-icon text-[18px]">{{ terminalExpanded ? '▾' : '▸' }}</span>
        <span>{{ $t('list.console') }}</span>
      </button>
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
        <button
          v-if="showWindowBtn"
          class="console-action--show rounded-lg border border-solid px-4 py-2 text-[14px] cursor-pointer disabled:cursor-default disabled:opacity-40 border-[var(--accent)] bg-[var(--surface)] font-semibold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--bg)]"
          @click="api.focusComfyWindow(installationId!)"
        >
          {{ $t('running.showWindow') }}
        </button>
        <button
          v-if="comfyUrl && runningInfo?.mode === 'console'"
          class="console-action--browser rounded-lg border border-solid px-4 py-2 text-[14px] cursor-pointer disabled:cursor-default disabled:opacity-40 border-[var(--border)] bg-[var(--surface)] text-text hover:bg-[var(--border)]"
          @click="api.openPath(comfyUrl)"
        >
          {{ $t('console.openInBrowser') }}
        </button>
        <button
          v-if="isStopping"
          class="console-action--stop rounded-lg border border-solid px-4 py-2 text-[14px] cursor-pointer disabled:cursor-default disabled:opacity-40 border-[var(--danger)] bg-[var(--danger)] text-[var(--bg)] hover:bg-[color-mix(in_srgb,var(--danger)_85%,#000)]"
          disabled
        >
          {{ $t('console.stopping') }}
        </button>
        <button
          v-else-if="!isExited && !errorInfo"
          class="console-action--stop rounded-lg border border-solid px-4 py-2 text-[14px] cursor-pointer disabled:cursor-default disabled:opacity-40 border-[var(--danger)] bg-[var(--danger)] text-[var(--bg)] hover:bg-[color-mix(in_srgb,var(--danger)_85%,#000)]"
          @click="api.stopComfyUI(installationId!)"
        >
          {{ $t('console.stop') }}
        </button>
        <button
          v-if="errorInfo"
          class="console-action--dismiss rounded-lg border border-solid px-4 py-2 text-[14px] cursor-pointer disabled:cursor-default disabled:opacity-40 border-[var(--border)] bg-[var(--surface)] text-text hover:bg-[var(--border)]"
          @click="(sessionStore.clearErrorInstance(installationId!), emit('close'))"
        >
          {{ $t('running.dismiss') }}
        </button>
      </div>
    </div>
  </div>
</template>
