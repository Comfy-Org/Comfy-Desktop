<script setup lang="ts">
import type { StyleValue } from 'vue'
import type { Starter } from '../createStarters'
import GhostGraph from './GhostGraph.vue'

export interface GraphPreviewItem {
  id: string
  name: string
  starter: Starter | null
  workflow: { name: string; cover?: string } | null
}

const {
  item,
  pan,
  opens = 'card'
} = defineProps<{
  item: GraphPreviewItem | null
  pan: StyleValue
  opens?: 'card' | 'row'
}>()
</script>

<template>
  <Transition name="gp-fade">
    <div v-if="item" class="gp-view" aria-hidden="true">
      <div class="gp-pan" :style="pan">
        <GhostGraph :key="item.id" :starter="item.starter" :workflow="item.workflow" />
      </div>
    </div>
  </Transition>
  <Transition name="gp-fade">
    <p v-if="item" class="mar-tip gp-label" role="status">
      Previewing {{ item.name }} · click the {{ opens }} to open<span class="gp-label-hint">
        · drag to move, scroll to zoom</span
      >
    </p>
  </Transition>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .gp-view {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .gp-pan {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 40px 56px 72px;
  transform-origin: 50% 50%;
  will-change: transform;
}
:root .proto-ui.proto-ui.proto-ui .gp-label {
  position: absolute;
  bottom: 14px;
  left: 50%;
  z-index: 4;
  max-width: calc(100% - 48px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateX(-50%);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .gp-label-hint {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .gp-fade-enter-active,
:root .proto-ui.proto-ui.proto-ui .gp-fade-leave-active {
  transition: opacity 180ms ease;
}
:root .proto-ui.proto-ui.proto-ui .gp-fade-enter-from,
:root .proto-ui.proto-ui.proto-ui .gp-fade-leave-to {
  opacity: 0;
}
@media (max-width: 1180px) {
  :root .proto-ui.proto-ui.proto-ui .gp-label-hint {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .gp-fade-enter-active,
  :root .proto-ui.proto-ui.proto-ui .gp-fade-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
