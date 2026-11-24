<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import MediaCard from '../ui/MediaCard.vue'

defineEmits<{ open: [] }>()
</script>

<template>
  <MediaCard class="nwt" @click="$emit('open')" @keydown.enter="$emit('open')">
    <template #media>
      <span class="nwt-media">
        <span class="mbr-new-plus nwt-plus"><Plus :size="18" /></span>
      </span>
    </template>
    <p class="truncate text-ui font-medium">New workflow</p>
    <p class="mt-1 truncate text-ui text-subtle-foreground">Blank, or from a template</p>
  </MediaCard>
</template>

<style>
.nwt-media {
  display: grid;
  height: 100%;
  place-items: center;
}
.nwt:hover .nwt-plus {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
}
</style>
