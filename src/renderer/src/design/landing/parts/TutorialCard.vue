<script setup lang="ts">
import { SquareArrowOutUpRight } from 'lucide-vue-next'
import { GraphIcon, AppIcon } from '../mar/icons/kindIcons'
import Badge from '../ui/Badge.vue'
import MediaCard from '../ui/MediaCard.vue'
import { toast } from '../useProto'
import { thumb, type Tutorial } from '../mock'

const { t } = defineProps<{ t: Tutorial }>()
</script>

<template>
  <MediaCard
    :src="thumb(t.thumbId)"
    ratio="3/2"
    @click="toast(`Watch: ${t.title}`)"
    @keydown.enter="toast(`Watch: ${t.title}`)"
  >
    <template #top-left>
      <Badge variant="overlay" size="md">
        <GraphIcon v-if="t.kind === 'graph'" :size="12" /><AppIcon v-else :size="12" />
        {{ t.kind === 'graph' ? 'Node graph' : 'App' }}
      </Badge>
    </template>
    <template #bottom-right
      ><Badge variant="overlay" size="md" class="tabular-nums">{{ t.minutes }} min</Badge></template
    >
    <span class="text-ui font-semibold tracking-wider text-subtle-foreground uppercase">{{
      t.category
    }}</span>
    <h3 class="mt-1.5 mb-1 text-[13.5px] font-semibold">{{ t.title }}</h3>
    <p class="mb-3.5 text-ui leading-normal text-muted-foreground">{{ t.blurb }}</p>
    <span class="mt-auto inline-flex items-center gap-1.5 text-ui"
      >Watch tutorial <SquareArrowOutUpRight :size="12"
    /></span>
  </MediaCard>
</template>
