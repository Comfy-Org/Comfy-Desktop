<script setup lang="ts">
// A flow that takes over the window (a new build), in the design system:
// the dashboard's glass page with its content panel, the flow's content
// scrolling in the middle and its actions in a bar at the bottom. Owns the
// teleport and the dialog a11y baseline, like BrandTakeoverLayout does for
// the brand screens.
import { ref } from 'vue'
import { useTakeoverFocus } from '../composables/useTakeoverFocus'
import { providePaletteScope } from '../composables/usePaletteScope'

defineProps<{ ariaLabel?: string }>()

const paletteScope = providePaletteScope()
const rootRef = ref<HTMLElement | null>(null)
useTakeoverFocus(rootRef)
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      :class="[
        'ds-root ds-page fixed inset-0 z-50 flex animate-fade-in bg-app-background outline-none motion-reduce:animate-none',
        paletteScope
      ]"
      data-theme="dark"
      data-testid="takeover-root"
      role="dialog"
      aria-modal="true"
      :aria-label="ariaLabel"
      tabindex="-1"
    >
      <div class="ds-content flex min-w-0 flex-1 flex-col overflow-hidden">
        <div class="scrollbar-quiet min-h-0 flex-1 overflow-y-auto">
          <div class="mx-auto w-full max-w-160 px-10 pb-12"><slot /></div>
        </div>
        <footer
          v-if="$slots['footer-left'] || $slots.footer"
          class="flex shrink-0 items-center gap-3 border-t border-border-default px-6 py-4"
        >
          <slot name="footer-left" />
          <div class="ml-auto flex items-center gap-2"><slot name="footer" /></div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
