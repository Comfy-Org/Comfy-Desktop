<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, useSlots } from 'vue'
import SharedTooltip from '@comfyorg/design-system/tooltip/Tooltip'
import TooltipContent from '@comfyorg/design-system/tooltip/TooltipContent'
import TooltipProvider from '@comfyorg/design-system/tooltip/TooltipProvider'
import TooltipTrigger from '@comfyorg/design-system/tooltip/TooltipTrigger'

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
  }>(),
  {
    text: undefined,
    side: 'top',
    align: 'center',
    delayMs: 100,
    disabled: false,
    interactive: false,
    keepOpenOnClick: false,
    shouldOpen: undefined
  }
)
defineOptions({ inheritAttrs: false })
const slots = useSlots()
const open = ref(false)
const labelId = useId()
const unavailable = computed(() => props.disabled || (!props.text && !slots.content))
function setOpen(next: boolean): void {
  open.value = next && !unavailable.value && (props.shouldOpen?.() ?? true)
}
function onFocusOut(event: FocusEvent): void {
  setOpen(
    props.interactive &&
      event.relatedTarget instanceof Element &&
      event.relatedTarget.closest('.tooltip-bubble--interactive') !== null
  )
}
function close(): void {
  open.value = false
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
        class="tooltip-bubble z-[10001] max-w-[260px] bg-foreground text-background [&_svg]:fill-foreground"
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
        @focusout="onFocusOut"
      >
        <span v-if="interactive && text" :id="labelId" hidden>{{ text }}</span>
        <slot name="content">{{ text }}</slot>
      </TooltipContent>
    </SharedTooltip>
  </TooltipProvider>
</template>
