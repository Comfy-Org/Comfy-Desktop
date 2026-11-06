<script setup lang="ts">
import { computed } from 'vue'
import { AudioLines, Box, Image, Video } from 'lucide-vue-next'

/** The chip in a template card's corner (Mar's proposal): the real icon
 *  for what the workflow makes, and its name sliding out when the card is
 *  hovered or focused. Same look as the media chip. */
const { category } = defineProps<{ category: 'image' | 'video' | '3d' | 'audio' }>()

const META = {
  image: { icon: Image, label: 'Image' },
  video: { icon: Video, label: 'Video' },
  '3d': { icon: Box, label: '3D' },
  audio: { icon: AudioLines, label: 'Audio' }
} as const
const meta = computed(() => META[category])
</script>

<template>
  <span
    class="inline-flex h-6 items-center rounded-full bg-media-overlay px-1.5 text-[11px] leading-none font-medium text-white/92 backdrop-blur-md"
    :aria-label="meta.label"
  >
    <component :is="meta.icon" :size="12" aria-hidden="true" class="shrink-0" />
    <span
      class="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity,margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:ml-1 group-hover:grid-cols-[1fr] group-hover:opacity-100 group-focus-visible:ml-1 group-focus-visible:grid-cols-[1fr] group-focus-visible:opacity-100 motion-reduce:transition-none"
      aria-hidden="true"
      ><span class="min-w-0 overflow-hidden whitespace-nowrap pr-0.5">{{ meta.label }}</span></span
    >
  </span>
</template>
