<script setup lang="ts">
import { ref } from 'vue'
import Tooltip from './ui/Tooltip.vue'
import { useTruncation } from '../composables/useTruncation'

/** Single-line content that ellipsizes when it overflows and reveals `text` in a
 *  tooltip only when actually clipped. Renders `text` by default; pass a slot for
 *  styled inner markup (the tooltip still uses `text`). */
const { text } = defineProps<{ text: string }>()

const labelRef = ref<HTMLElement | null>(null)
const { isTruncated, check } = useTruncation(labelRef)
</script>

<template>
  <Tooltip :text="text" :disabled="!isTruncated">
    <span ref="labelRef" class="truncated-text" @mouseenter="check" @focusin="check">
      <slot>{{ text }}</slot>
    </span>
  </Tooltip>
</template>

<style scoped>
.truncated-text {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
