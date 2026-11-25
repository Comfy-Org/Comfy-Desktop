<script setup lang="ts">
import MediaCard from '../ui/MediaCard.vue'
import WorkflowCover from './brand/WorkflowCover.vue'
import { cover, isBranded, type RecentsCover } from './cover'
import ReadinessBadge from './templateModal/ReadinessBadge.vue'

/** A workflow with its image, title, and a meta line with a value on the
 *  right (size, where it ran, when). The image stays still on hover: Mar's
 *  cards never grow, so it skips MediaCard's default zoom. */
defineProps<{
  src: string
  title: string
  meta: string
  right?: string
  /** An app keeps its own picture, never the workflow cover. */
  app?: boolean
  coverKind?: RecentsCover
  readinessOf?: string
}>()
defineEmits<{ open: [] }>()
</script>

<template>
  <MediaCard @click="$emit('open')" @keydown.enter="$emit('open')">
    <template #media>
      <WorkflowCover
        v-if="!app && (coverKind ? coverKind === 'generic' : isBranded(cover.id))"
        :name="title"
      />
      <img v-else :src alt="" loading="lazy" class="size-full object-cover" />
    </template>
    <template v-if="readinessOf" #top-left>
      <ReadinessBadge :id="readinessOf" />
    </template>
    <p class="truncate text-ui font-medium">{{ title }}</p>
    <p class="mt-1 flex items-center gap-2 text-ui text-subtle-foreground">
      <span class="min-w-0 flex-1 truncate">{{ meta }}</span>
      <span v-if="right" class="shrink-0">{{ right }}</span>
    </p>
  </MediaCard>
</template>
