<script setup lang="ts">
// Height-animated disclosure via a CSS `grid-template-rows: 0fr → 1fr`
// transition, which covers the exact content height without a max-height cap.

interface Props {
  open: boolean
  duration?: number
}

withDefaults(defineProps<Props>(), { duration: 220 })
</script>

<template>
  <div
    class="ui-accordion grid transition-[grid-template-rows] duration-[var(--ui-accordion-duration)] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-0"
    :class="open ? 'is-open grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    :style="{ '--ui-accordion-duration': `${duration}ms` }"
    :data-state="open ? 'open' : 'closed'"
  >
    <!-- `inert` removes the collapsed content from the focus order and
         the a11y tree, so Tab doesn't land on hidden buttons. -->
    <div
      class="ui-accordion-inner min-h-0 overflow-hidden transition-opacity duration-[var(--ui-accordion-duration)] ease-[ease] motion-reduce:duration-0"
      :class="open ? 'opacity-100' : 'opacity-0'"
      :aria-hidden="!open"
      :inert="!open || undefined"
    >
      <slot />
    </div>
  </div>
</template>
