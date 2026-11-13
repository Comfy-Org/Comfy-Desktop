<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { forceStates } from './force'

/**
 * One state of a real component, its state as the caption.
 *
 * `force`: states to switch on ("hover", "focus", "active", or several),
 *   on `target` (a selector inside the cell) or on everything in it.
 * `attrs`: attributes to set on `target` (`data-state`, `data-highlighted`).
 * `on`: what the sample sits on, like in the app: the page (`main`, the
 *   default), the sidebar, or nothing (`bare`).
 */
const {
  label,
  force = '',
  target,
  attrs,
  on = 'main',
  fill = false,
  height
} = defineProps<{
  label?: string
  force?: string
  target?: string
  attrs?: Record<string, string>
  on?: 'main' | 'sidebar' | 'bare'
  fill?: boolean
  height?: number
}>()

const stage = ref<HTMLElement>()
let stop: (() => void) | undefined
onMounted(() => {
  if (stage.value && (force || attrs)) stop = forceStates(stage.value, force, target, attrs)
})
onBeforeUnmount(() => stop?.())
</script>

<template>
  <figure class="ds-cell">
    <div
      :class="[
        'ds-cell-surface',
        on === 'main' && 'proto-main',
        on === 'sidebar' && 'proto-sidebar'
      ]"
      :style="height ? { minHeight: `${height}px` } : undefined"
    >
      <div ref="stage" :class="['ds-cell-stage', fill && 'is-fill']"><slot /></div>
    </div>
    <figcaption v-if="label" class="ds-cell-label">{{ label }}</figcaption>
  </figure>
</template>
