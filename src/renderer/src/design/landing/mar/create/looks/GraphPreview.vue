<script setup lang="ts">
import type { StyleValue } from 'vue'
import { X } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import type { Starter } from '../createStarters'
import GhostGraph from './GhostGraph.vue'

export interface GraphPreviewItem {
  id: string
  name: string
  starter: Starter | null
  workflow: { name: string; cover?: string } | null
}

const { item, pan } = defineProps<{
  item: GraphPreviewItem | null
  pan: StyleValue
}>()
const emit = defineEmits<{ open: []; close: [] }>()
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
    <div v-if="item" class="mar-tip gp-label" @pointerdown.stop @pointermove.stop @wheel.stop>
      <span class="gp-label-text" role="status"
        >Previewing {{ item.name
        }}<span class="gp-label-hint"> · drag to move, scroll to zoom</span></span
      >
      <Button variant="link" size="sm" class="gp-label-open" @click="emit('open')">Open</Button>
      <Button variant="ghost" size="icon-xs" aria-label="Close preview" @click="emit('close')">
        <X :size="13" />
      </Button>
    </div>
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
  display: flex;
  max-width: calc(100% - 48px);
  align-items: center;
  gap: 8px;
  padding-block: 3px;
  padding-right: 4px;
  transform: translateX(-50%);
}
:root .proto-ui.proto-ui.proto-ui .gp-label-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .gp-label-open {
  height: 24px;
  color: var(--color-base-foreground);
  font-size: 12px;
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
