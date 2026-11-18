<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useElementVisibility } from '@vueuse/core'
import { AudioLines, Box, File } from '@lucide/vue'
import type { OutputDetailItem } from './OutputDetailDialog.vue'

const { entry } = defineProps<{ entry: OutputDetailItem }>()

const frame = useTemplateRef<HTMLElement>('frame')
const seen = useElementVisibility(frame, { once: true })
const still = computed(() => {
  if (entry.kind === 'image') return entry.thumbnailUrl ?? entry.previewUrl
  return entry.kind === '3d' ? entry.thumbnailUrl : null
})
</script>

<template>
  <span ref="frame" class="flex size-full items-center justify-center">
    <img v-if="still" :src="still" alt="" loading="lazy" class="size-full object-cover" />
    <template v-else-if="entry.kind === 'video' && entry.previewUrl">
      <video
        v-if="seen"
        :src="entry.previewUrl"
        preload="metadata"
        muted
        class="size-full object-cover"
      />
    </template>
    <AudioLines v-else-if="entry.kind === 'audio'" :size="16" aria-hidden="true" />
    <Box v-else-if="entry.kind === '3d'" :size="16" aria-hidden="true" />
    <File v-else :size="16" aria-hidden="true" />
  </span>
</template>
