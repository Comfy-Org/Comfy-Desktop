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
      class="info-tooltip-trigger"
      tabindex="0"
      role="button"
      :aria-label="props.text"
      :data-icon="props.icon"
    >
      <Info v-if="props.icon === 'info'" :size="14" class="info-tooltip-icon" />
      <CircleHelp v-else :size="14" class="info-tooltip-icon" />
    </span>
    <template v-if="props.linkUrl" #content>
      <span class="info-tooltip-content">
        <span>{{ props.text }}</span>
        <a class="info-tooltip-link" :href="props.linkUrl" @click.prevent.stop="openLink">
          {{ props.linkLabel }}
        </a>
      </span>
    </template>
  </Tooltip>
</template>

<style scoped>
.info-tooltip-trigger {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  vertical-align: middle;
  cursor: help;
}

.info-tooltip-icon {
  color: var(--text-muted);
  opacity: 0.85;
  transition:
    opacity 0.15s,
    color 0.15s;
  flex-shrink: 0;
}

.info-tooltip-trigger:hover .info-tooltip-icon,
.info-tooltip-trigger:focus-visible .info-tooltip-icon {
  opacity: 1;
  color: var(--accent);
}

.info-tooltip-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-tooltip-link {
  width: fit-content;
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

.info-tooltip-link:hover,
.info-tooltip-link:focus-visible {
  color: var(--accent-hover);
  text-decoration: underline;
}
</style>
