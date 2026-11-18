<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, useId, useSlots, watch } from 'vue'
import SharedTooltip from '@comfyorg/design-system/tooltip/Tooltip'
import TooltipContent from '@comfyorg/design-system/tooltip/TooltipContent'
import TooltipProvider from '@comfyorg/design-system/tooltip/TooltipProvider'
import TooltipTrigger from '@comfyorg/design-system/tooltip/TooltipTrigger'
import { TOOLTIP_GATE } from './tooltipGate'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'
export type TooltipAlign = 'start' | 'center' | 'end'

const props = withDefaults(
  defineProps<{
    text?: string
    side?: TooltipSide
    align?: TooltipAlign
    delayMs?: number
    disabled?: boolean
    interactive?: boolean
    keepOpenOnClick?: boolean
    shouldOpen?: () => boolean
    shownWhile?: boolean
  }>(),
  {
    text: undefined,
    side: 'top',
    align: 'center',
    delayMs: 100,
    disabled: false,
    interactive: false,
    keepOpenOnClick: false,
    shouldOpen: undefined,
    shownWhile: false
  }
)
defineOptions({ inheritAttrs: false })
const slots = useSlots()
const open = ref(false)
const wanted = ref(false)
const gateOpen = inject(TOOLTIP_GATE, () => true)
const labelId = useId()
const unavailable = computed(() => props.disabled || (!props.text && !slots.content))
const dismissed = ref(false)
function refresh(): void {
  const requested = wanted.value || (props.shownWhile && !dismissed.value)
  open.value = requested && !unavailable.value && gateOpen() && (props.shouldOpen?.() ?? true)
}
function setOpen(next: boolean): void {
  wanted.value = next
  refresh()
}
watch(gateOpen, refresh)
watch(
  () => props.shownWhile,
  () => {
    dismissed.value = false
    refresh()
  },
  { immediate: true }
)
function onFocusOut(event: FocusEvent): void {
  setOpen(
    props.interactive &&
      event.relatedTarget instanceof Element &&
      event.relatedTarget.closest('.tooltip-bubble--interactive') !== null
  )
}
function close(): void {
  dismissed.value = true
  setOpen(false)
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  event.stopPropagation()
  close()
}
onMounted(() => window.addEventListener('blur', close))
onBeforeUnmount(() => window.removeEventListener('blur', close))
</script>

<template>
  <TooltipProvider :delay-duration="delayMs" :skip-delay-duration="0">
    <SharedTooltip
      :open="open"
      :disabled="unavailable"
      :delay-duration="delayMs"
      :ignore-non-keyboard-focus="false"
      :disable-hoverable-content="!interactive"
      :disable-closing-trigger="keepOpenOnClick"
      @update:open="setOpen"
    >
      <TooltipTrigger as-child>
        <span
          v-bind="$attrs"
          class="tooltip-wrap inline-flex"
          @focusin="setOpen(true)"
          @focusout="onFocusOut"
          @keydown="onKeydown"
        >
          <slot />
        </span>
      </TooltipTrigger>
      <TooltipContent
        class="tooltip-bubble z-[10001] max-w-[256px] rounded-[var(--radius-control)] border-[var(--tooltip-border)] bg-[var(--tooltip-bg)] px-[9px] py-[5px] text-[12px]/[16.2px] font-medium text-[var(--tooltip-fg)] shadow-[0_8px_12px_rgb(0_0_0/0.5)] backdrop-blur-[10px] [&>span:has(>svg)]:hidden"
        :class="
          interactive ? 'tooltip-bubble--interactive pointer-events-auto' : 'pointer-events-none'
        "
        :side="side"
        :align="align"
        :role="interactive ? 'dialog' : undefined"
        :aria-label="interactive ? text : undefined"
        :aria-labelledby="interactive && text ? labelId : undefined"
        :collision-padding="8"
        @keydown.capture="onKeydown"
        @escape-key-down="close"
        @focusout="onFocusOut"
      >
        <span v-if="interactive && text" :id="labelId" hidden>{{ text }}</span>
        <slot name="content">{{ text }}</slot>
      </TooltipContent>
    </SharedTooltip>
  </TooltipProvider>
</template>
