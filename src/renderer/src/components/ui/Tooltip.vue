<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots } from 'vue'
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
  }>(),
  {
    text: undefined,
    side: 'top',
    align: 'center',
    delayMs: 100,
    disabled: false,
    interactive: false
  }
)
defineOptions({ inheritAttrs: false })
const slots = useSlots()
const open = ref(false)
const unavailable = computed(() => props.disabled || (!props.text && !slots.content))
function onFocusOut(event: FocusEvent): void {
  if (
    props.interactive &&
    event.relatedTarget instanceof Element &&
    event.relatedTarget.closest('.tooltip-bubble--interactive')
  ) {
    open.value = !unavailable.value
    return
  }
  close()
}
function close(): void {
  open.value = false
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  open.value = false
}
onMounted(() => window.addEventListener('blur', close))
onBeforeUnmount(() => window.removeEventListener('blur', close))
</script>

<template>
  <TooltipProvider :delay-duration="delayMs" :skip-delay-duration="0">
    <SharedTooltip
      v-model:open="open"
      :disabled="unavailable"
      :delay-duration="delayMs"
      :ignore-non-keyboard-focus="false"
      :disable-hoverable-content="!interactive"
    >
      <TooltipTrigger as-child>
        <span
          v-bind="$attrs"
          class="tooltip-wrap inline-flex"
          @focusin="open = !unavailable"
          @focusout="onFocusOut"
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
        :role="interactive ? 'dialog' : 'tooltip'"
        :aria-label="interactive ? text : undefined"
        :collision-padding="8"
        @keydown.capture="onKeydown"
        @focusout="onFocusOut"
        @escape-key-down="(event) => event.stopPropagation()"
      >
        <slot name="content">{{ text }}</slot>
      </TooltipContent>
    </SharedTooltip>
  </TooltipProvider>
</template>
