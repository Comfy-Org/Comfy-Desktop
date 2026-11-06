<script setup lang="ts">
import MediaCard from '../ui/MediaCard.vue'
import WorkflowCover from './brand/WorkflowCover.vue'
import { cover, isBranded } from './cover'

/** A workflow with its image, title, and a meta line with a value on the
 *  right (size, where it ran, when). The image stays still on hover: Mar's
 *  cards never grow, so it skips MediaCard's default zoom. */
defineProps<{
  src: string
  title: string
  meta: string
  right?: string
}>()
defineEmits<{ open: [] }>()
</script>

<template>
  <MediaCard @click="$emit('open')" @keydown.enter="$emit('open')">
    <template #media>
      <WorkflowCover v-if="isBranded(cover.id)" :name="title" />
      <img v-else :src alt="" loading="lazy" class="size-full object-cover" />
    </template>
    <p class="truncate text-ui font-medium">{{ title }}</p>
    <p class="mt-1 flex items-center gap-2 text-ui text-subtle-foreground">
      <span class="min-w-0 flex-1 truncate">{{ meta }}</span>
      <span v-if="right" class="shrink-0">{{ right }}</span>
    </p>
  </MediaCard>
</template>
