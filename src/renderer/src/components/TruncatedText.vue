<script setup lang="ts">
import { ref } from 'vue'
import Tooltip from './ui/Tooltip.vue'

/** Single-line content that ellipsizes when it overflows and reveals `text` in a
 *  tooltip only when actually clipped. Renders `text` by default; pass a slot for
 *  styled inner markup (the tooltip still uses `text`). */
const { text } = defineProps<{ text: string }>()

const labelRef = ref<HTMLElement | null>(null)

function isClipped(): boolean {
  return !!labelRef.value && labelRef.value.scrollWidth > labelRef.value.clientWidth
}
</script>

<template>
  <Tooltip :text="text" :should-open="isClipped">
    <span ref="labelRef" class="truncated-text block truncate">
      <slot>{{ text }}</slot>
    </span>
  </Tooltip>
</template>
