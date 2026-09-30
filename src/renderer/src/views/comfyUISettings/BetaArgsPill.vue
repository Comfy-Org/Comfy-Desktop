<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { ChevronDown, ChevronRight, FlaskConical } from 'lucide-vue-next'
import Tooltip from '../../components/ui/Tooltip.vue'
import { BETA_FEATURES_FIELD_ID } from '../../comfyTitleBar/useBetaActivationNotice'
import type { BetaArgView } from '../../types/ipc'

/**
 * Collapsed "+N beta" pill after the user's startup args: the Core beta grants on the running
 * session's command line. Read-only — the only way to change them is the beta opt-in switch,
 * which the popover links to. Renders nothing when no grant is active.
 */

const props = defineProps<{
  args: readonly BetaArgView[]
}>()

const { t } = useI18n()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const popoverId = `beta-args-${useId()}`

const count = computed(() => props.args.length)
const heading = computed(() => t('comfyUISettings.betaArgsHeading'))

function toggle(): void {
  open.value = !open.value
}

function close(restoreFocus: boolean): void {
  if (!open.value) return
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

/** Escape closes an open popover without letting it reach the host popup's window-level Escape,
 *  which would dismiss the whole popup. With the popover closed it passes through untouched. */
function onEscape(event: KeyboardEvent): void {
  if (!open.value) return
  event.stopPropagation()
  close(true)
}

function manage(): void {
  close(false)
  window.api.openGlobalSettings('general', { highlightField: BETA_FEATURES_FIELD_ID })
}

onClickOutside(root, () => close(false))
// A click in another WebContents never reaches this document's pointer listener.
useEventListener(window, 'blur', () => close(false))
</script>

<template>
  <span v-if="count > 0" ref="root" class="beta-args">
    <Tooltip :text="t('comfyUISettings.betaArgsTooltip', { n: count }, count)" :disabled="open">
      <button
        ref="trigger"
        type="button"
        class="beta-args-pill"
        :class="{ 'is-open': open }"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-controls="popoverId"
        :aria-label="t('comfyUISettings.betaArgsAriaLabel', { n: count }, count)"
        @click="toggle"
        @keydown.escape="onEscape"
      >
        <FlaskConical :size="12" class="beta-args-flask" aria-hidden="true" />
        <span>{{ t('comfyUISettings.betaArgsPill', { n: count }) }}</span>
        <ChevronDown :size="12" aria-hidden="true" />
      </button>
    </Tooltip>
    <div
      v-if="open"
      :id="popoverId"
      class="beta-args-popover"
      role="dialog"
      :aria-label="heading"
      @keydown.escape="onEscape"
    >
      <div class="beta-args-heading">{{ heading }}</div>
      <ul class="beta-args-list">
        <li v-for="view in args" :key="view.arg" class="beta-args-row">
          <code class="beta-args-flag">{{ view.arg }}</code>
          <span class="beta-args-name">{{
            view.name ?? t('comfyUISettings.betaArgsUnnamed')
          }}</span>
        </li>
      </ul>
      <button type="button" class="beta-args-manage" @click="manage">
        {{ t('comfyUISettings.betaArgsManage') }}
        <ChevronRight :size="12" aria-hidden="true" />
      </button>
    </div>
  </span>
</template>

<style scoped>
/* Selectors are qualified by `.beta-args` to outrank BaseInput's `.ui-input-trailing :deep(button)`
 * icon-button sizing, which otherwise squeezes every button in the trailing slot to 28x28. */
.beta-args {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.beta-args .beta-args-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  height: 22px;
  padding: 0 6px 0 7px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 9999px;
  cursor: pointer;
}

.beta-args .beta-args-pill:hover,
.beta-args .beta-args-pill.is-open {
  color: var(--text);
  border-color: var(--text-muted);
  background: var(--border-hover);
}

.beta-args .beta-args-pill:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}

.beta-args-flask {
  color: var(--accent-plum);
}

.beta-args-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 50;
  width: 300px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  cursor: default;
}

.beta-args-heading {
  padding: 6px 8px 4px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.beta-args-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.beta-args-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  font-size: 12px;
}

.beta-args-flag {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  color: var(--text);
}

.beta-args-name {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-muted);
}

.beta-args .beta-args-manage {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  height: auto;
  margin-top: 4px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--accent-primary);
  background: transparent;
  border: none;
  border-top: 1px solid var(--border);
  border-radius: 0 0 6px 6px;
  cursor: pointer;
}

.beta-args .beta-args-manage:hover {
  color: var(--accent-hover);
  background: transparent;
}

.beta-args .beta-args-manage:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: -2px;
}
</style>
