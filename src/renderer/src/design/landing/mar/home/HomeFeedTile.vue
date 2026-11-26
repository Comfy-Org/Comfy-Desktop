<script setup lang="ts">
import { ref } from 'vue'
import MediaCard from '../../ui/MediaCard.vue'
import HomeMedia from './HomeMedia.vue'
import type { FeedItem } from './homeFeed'
import './homeVersions.css'

const { item, ratio = '16/10' } = defineProps<{ item: FeedItem; ratio?: string }>()
const emit = defineEmits<{ open: [] }>()
const playing = ref(false)
</script>

<template>
  <MediaCard
    class="hv-card"
    :ratio="ratio"
    :aria-label="`Open ${item.title}`"
    @click="emit('open')"
    @keydown.enter="emit('open')"
    @pointerenter="playing = true"
    @pointerleave="playing = false"
    @focusin="playing = true"
    @focusout="playing = false"
  >
    <template #media>
      <HomeMedia :src="item.src" :clip="item.clip" :playing="playing" />
      <span v-if="item.length" class="hv-badge"
        ><component :is="item.length.icon" :size="12" />{{ item.length.label }}</span
      >
    </template>
    <p class="truncate text-ui font-medium">{{ item.title }}</p>
    <p class="mt-1 flex items-center gap-2 text-ui text-subtle-foreground">
      <span class="min-w-0 flex-1 truncate">{{ item.line }}</span>
      <span v-if="item.right" class="shrink-0">{{ item.right }}</span>
    </p>
  </MediaCard>
</template>
