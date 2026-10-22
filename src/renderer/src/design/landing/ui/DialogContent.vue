<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { PORTAL_TO } from './portal'

/** Centered modal surface with scrim. Pair with reka's DialogRoot,
 *  DialogTitle and DialogDescription. */
const {
  size = 'md',
  closable = true,
  class: className
} = defineProps<{
  size?: 'sm' | 'md' | 'lg'
  closable?: boolean
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <DialogPortal :to="PORTAL_TO" defer>
    <DialogOverlay
      class="proto-ui fixed inset-0 z-50 bg-media-overlay backdrop-blur-[3px] data-[state=open]:animate-fade-in"
    />
    <DialogContent
      :class="
        cn(
          'proto-ui fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-border-default bg-card-background text-base-foreground shadow-elev outline-none data-[state=open]:animate-pop-in',
          size === 'sm' && 'w-[380px] rounded-panel',
          size === 'md' && 'w-[420px] rounded-panel',
          size === 'lg' && 'w-[min(920px,calc(100vw-48px))] rounded-panel',
          className
        )
      "
    >
      <slot />
      <DialogClose
        v-if="closable"
        aria-label="Close"
        class="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full text-subtle-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        <X :size="15" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
