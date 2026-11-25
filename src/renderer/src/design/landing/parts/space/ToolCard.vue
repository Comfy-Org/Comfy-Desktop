<script setup lang="ts">
import {} from 'lucide-vue-next'
import { GraphIcon, AppIcon } from '../../mar/icons/kindIcons'
import Badge from '../../ui/Badge.vue'
import MediaCard from '../../ui/MediaCard.vue'
import { FLAVOR_LABEL, type CatalogItem } from '../../spaces'
import { thumb } from '../../mock'

/** A tool in a client space: an app or a simplified workflow. */
const { item } = defineProps<{ item: CatalogItem }>()
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <MediaCard :src="thumb(item.thumbId)" @click="emit('open')" @keydown.enter="emit('open')">
    <template #top-left>
      <Badge variant="overlay" size="md">
        <AppIcon v-if="item.flavor === 'app'" :size="12" /><GraphIcon v-else :size="12" />
        {{ FLAVOR_LABEL[item.flavor] }}
      </Badge>
    </template>
    <template v-if="item.isNew" #top-right>
      <Badge variant="solid" size="md">New</Badge>
    </template>
    <p class="truncate text-ui font-semibold">{{ item.name }}</p>
    <p class="mt-1 line-clamp-2 text-ui text-muted-foreground">{{ item.blurb }}</p>
    <p class="mt-2.5 text-ui text-subtle-foreground tabular-nums">{{ item.cost }} credits a run</p>
  </MediaCard>
</template>
