<script setup lang="ts">
import { CircleHelp, Info } from 'lucide-vue-next'
import Tooltip from './ui/Tooltip.vue'
import type { TooltipSide } from '../composables/useTooltip'

// Inline help-icon trigger composing the shared Tooltip primitive; defers
// placement, teleport, arrow, and collision handling to it.
const props = withDefaults(
  defineProps<{
    text: string
    side?: TooltipSide
    delayMs?: number
    linkUrl?: string
    linkLabel?: string
    icon?: 'help' | 'info'
  }>(),
  { side: 'top', delayMs: 100, linkUrl: undefined, linkLabel: undefined, icon: 'help' }
)

const iconClass =
  'info-tooltip-icon shrink-0 text-text-muted opacity-85 transition-[opacity,color] duration-150 ease-[ease] group-hover/info-tooltip:text-[var(--accent)] group-hover/info-tooltip:opacity-100 group-focus-visible/info-tooltip:text-[var(--accent)] group-focus-visible/info-tooltip:opacity-100'

function openLink(): void {
  if (props.linkUrl) void window.api.openExternal(props.linkUrl)
}
</script>

<template>
  <Tooltip
    :text="props.text"
    :side="props.side"
    :delay-ms="props.delayMs"
    :interactive="!!props.linkUrl"
  >
    <span
      class="info-tooltip-trigger group/info-tooltip ml-1 inline-flex cursor-help items-center align-middle"
      tabindex="0"
      role="button"
      :aria-label="props.text"
      :data-icon="props.icon"
    >
      <Info v-if="props.icon === 'info'" :size="14" :class="iconClass" />
      <CircleHelp v-else :size="14" :class="iconClass" />
    </span>
    <template v-if="props.linkUrl" #content>
      <span class="info-tooltip-content flex flex-col gap-1.5">
        <span>{{ props.text }}</span>
        <a
          class="info-tooltip-link w-fit font-semibold text-[var(--accent)] no-underline hover:text-accent-hover hover:underline focus-visible:text-accent-hover focus-visible:underline"
          :href="props.linkUrl"
          @click.prevent.stop="openLink"
        >
          {{ props.linkLabel }}
        </a>
      </span>
    </template>
  </Tooltip>
</template>
