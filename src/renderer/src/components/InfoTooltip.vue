<script setup lang="ts">
import { CircleHelp, Info } from 'lucide-vue-next'
import Tooltip from './ui/Tooltip.vue'
import type { TooltipSide } from './ui/Tooltip.vue'

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
  'info-tooltip-icon shrink-0 text-text-muted opacity-85 transition-[opacity,color] duration-150 ease-[ease] group-hover/info-tooltip:text-[var(--action)] group-hover/info-tooltip:opacity-100 group-focus-visible/info-tooltip:text-[var(--action)] group-focus-visible/info-tooltip:opacity-100'

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
    keep-open-on-click
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
          class="info-tooltip-link w-fit font-semibold text-inherit underline underline-offset-2 hover:opacity-80 focus-visible:opacity-80"
          :href="props.linkUrl"
          @click.prevent.stop="openLink"
        >
          {{ props.linkLabel }}
        </a>
      </span>
    </template>
  </Tooltip>
</template>
