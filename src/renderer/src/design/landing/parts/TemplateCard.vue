<script setup lang="ts">
import { LayoutGrid, Waypoints } from 'lucide-vue-next'
import Badge from '../ui/Badge.vue'
import MediaCard from '../ui/MediaCard.vue'
import { openDetail } from '../useProto'
import { thumb, type Template } from '../mock'

const { t } = defineProps<{ t: Template }>()
</script>

<template>
  <MediaCard
    :src="thumb(t.id)"
    @click="openDetail('template', t.id)"
    @keydown.enter="openDetail('template', t.id)"
  >
    <template #top-left>
      <Badge
        variant="overlay"
        size="md"
        :aria-label="t.kind === 'graph' ? 'Node graph' : 'App'"
        class="px-1.5"
      >
        <Waypoints v-if="t.kind === 'graph'" :size="12" /><LayoutGrid v-else :size="12" />
      </Badge>
    </template>
    <p class="truncate text-ui font-medium">{{ t.title }}</p>
  </MediaCard>
</template>
