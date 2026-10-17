<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { PORTAL_TO } from '../portal'

/** Wrap an interactive element; it becomes the trigger. Needs a reka-ui
 *  TooltipProvider above it. `content` may hold several lines (`\n`). */
const { content, side = 'top' } = defineProps<{
  content: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}>()
</script>

<template>
  <TooltipRoot>
    <TooltipTrigger as-child><slot /></TooltipTrigger>
    <TooltipPortal :to="PORTAL_TO" defer>
      <TooltipContent
        :side
        :side-offset="6"
        class="ds-root z-[60] max-w-72 rounded-control whitespace-pre-line break-words bg-inverted-background px-2 py-1 text-ui font-medium text-inverted-foreground shadow-popover data-[state=delayed-open]:animate-fade-in"
      >
        {{ content }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
