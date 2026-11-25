<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { PORTAL_TO } from './portal'

/**
 * Wrap an interactive element; it becomes the trigger. Needs the
 * TooltipProvider mounted by LandingPrototypes.
 *
 * `wrap`: anchor on a wrapping span instead of the child. Use it around a
 * whole DropdownMenuRoot/PopoverRoot (never between a Root and its
 * Trigger: the trigger would register with the tooltip's popper and the
 * menu would have no anchor).
 */
const {
  content,
  side = 'top',
  wrap = false,
  disabled = false
} = defineProps<{
  content: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  wrap?: boolean
  /** Render the trigger without a tooltip (e.g. labels already visible). */
  disabled?: boolean
}>()
</script>

<template>
  <TooltipRoot :disabled>
    <TooltipTrigger v-if="wrap" as="span" class="inline-flex"><slot /></TooltipTrigger>
    <TooltipTrigger v-else as-child><slot /></TooltipTrigger>
    <TooltipPortal :to="PORTAL_TO" defer>
      <TooltipContent
        :side
        :side-offset="6"
        class="proto-ui mar-tip z-[60] max-w-64 rounded-control bg-inverted-background px-2 py-1 text-ui font-medium text-inverted-foreground shadow-popover data-[state=delayed-open]:animate-fade-in"
      >
        {{ content }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
