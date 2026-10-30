<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useSlots, watch } from 'vue'
import { useTooltip, type TooltipAlign, type TooltipSide } from '../../composables/useTooltip'

interface Props {
  text?: string
  side?: TooltipSide
  align?: TooltipAlign
  delayMs?: number
  disabled?: boolean
  interactive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  text: undefined,
  side: 'top',
  align: 'center',
  delayMs: 100,
  disabled: false,
  interactive: false
})

const slots = useSlots()

const triggerRef = ref<HTMLElement | null>(null)
const bubbleRef = ref<HTMLElement | null>(null)
const bubbleId = `tooltip-${useId()}`

const { visible, show, hide, bubbleStyle, resolvedSide, arrowStyle } = useTooltip(
  triggerRef,
  bubbleRef,
  {
    side: () => props.side,
    align: () => props.align,
    canShow: () => !props.disabled && (!!props.text || !!slots.content)
  }
)

// Keep the arrow pointed at the trigger after placement flips or clamps.
const arrowClasses: Record<TooltipSide, string> = {
  top: '-bottom-[5px] h-[6px] w-3 -translate-x-1/2 before:[clip-path:polygon(50%_100%,0_0,100%_0)]',
  bottom:
    '-top-[5px] h-[6px] w-3 -translate-x-1/2 before:[clip-path:polygon(50%_0,0_100%,100%_100%)]',
  left: '-right-[5px] h-3 w-[6px] -translate-y-1/2 before:[clip-path:polygon(100%_50%,0_0,0_100%)]',
  right:
    '-left-[5px] h-3 w-[6px] -translate-y-1/2 before:[clip-path:polygon(0_50%,100%_0,100%_100%)]'
}
const arrowFillClasses: Record<TooltipSide, string> = {
  top: '-top-px right-0 bottom-0 left-0 [clip-path:polygon(50%_85%,8%_0,92%_0)]',
  bottom: 'top-0 right-0 -bottom-px left-0 [clip-path:polygon(50%_15%,8%_100%,92%_100%)]',
  left: 'top-0 right-0 bottom-0 -left-px [clip-path:polygon(85%_50%,0_8%,0_92%)]',
  right: 'top-0 -right-px bottom-0 left-0 [clip-path:polygon(15%_50%,100%_8%,100%_92%)]'
}

const describedBy = computed(() => (visible.value ? bubbleId : undefined))

let openTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null

function onEnter(): void {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  if (visible.value) return
  if (openTimer) clearTimeout(openTimer)
  if (props.delayMs <= 0) {
    show()
    return
  }
  openTimer = setTimeout(() => {
    show()
    openTimer = null
  }, props.delayMs)
}

function onLeave(): void {
  if (openTimer) {
    clearTimeout(openTimer)
    openTimer = null
  }
  if (!props.interactive) {
    hide()
    return
  }
  closeTimer = setTimeout(() => {
    hide()
    closeTimer = null
  }, 100)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && visible.value) {
    e.stopPropagation()
    hide()
  }
}

// Disabling hides a bubble that is already up (and cancels a pending open), not just future
// ones: a trigger that opens its own popover disables its tooltip at the moment of the click.
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled) return
    if (openTimer) {
      clearTimeout(openTimer)
      openTimer = null
    }
    hide()
  }
)

onBeforeUnmount(() => {
  if (openTimer) clearTimeout(openTimer)
  if (closeTimer) clearTimeout(closeTimer)
})
</script>

<template>
  <span
    ref="triggerRef"
    class="tooltip-wrap inline-flex"
    :aria-describedby="describedBy"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="onEnter"
    @focusout="onLeave"
    @keydown="onKeydown"
  >
    <slot />
    <Teleport to="body">
      <span
        v-if="visible"
        :id="bubbleId"
        ref="bubbleRef"
        class="tooltip-bubble fixed z-[var(--z-tooltip)] max-w-[260px] rounded-[var(--primitive-border-radius-rounded-lg,8px)] border border-solid border-[var(--tooltip-border)] bg-[var(--tooltip-bg)] px-4 py-2 text-left text-xs leading-[1.4] font-normal whitespace-normal text-[var(--tooltip-fg)] shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
        :class="
          interactive ? 'tooltip-bubble--interactive pointer-events-auto' : 'pointer-events-none'
        "
        :data-side="resolvedSide"
        :style="bubbleStyle"
        :role="interactive ? 'dialog' : 'tooltip'"
        :aria-label="interactive ? text : undefined"
        @mouseenter="onEnter"
        @mouseleave="onLeave"
        @focusin="onEnter"
        @focusout="onLeave"
        @keydown="onKeydown"
      >
        <slot name="content">{{ text }}</slot>
        <span
          class="tooltip-arrow pointer-events-none absolute before:absolute before:inset-0 before:bg-[var(--tooltip-border)] before:content-['']"
          :class="arrowClasses[resolvedSide]"
          :style="arrowStyle"
          aria-hidden="true"
        >
          <span
            class="tooltip-arrow__fill absolute bg-[var(--tooltip-bg)]"
            :class="arrowFillClasses[resolvedSide]"
          />
        </span>
      </span>
    </Teleport>
  </span>
</template>
