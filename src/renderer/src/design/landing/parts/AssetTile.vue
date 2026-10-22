<script setup lang="ts">
import { computed } from 'vue'
import { Box, Music, Play } from 'lucide-vue-next'
import Badge from '../ui/Badge.vue'
import Checkbox from '../ui/Checkbox.vue'
import MediaCard from '../ui/MediaCard.vue'
import CloudDownloadMenu from './CloudDownloadMenu.vue'
import { localFolders, type GalleryAsset } from '../gallery'
import { instanceById, proto } from '../useProto'
import { thumb } from '../mock'

const {
  asset,
  selected = false,
  selecting = false
} = defineProps<{
  asset: GalleryAsset
  selected?: boolean
  selecting?: boolean
}>()
const emit = defineEmits<{ open: []; toggle: [] }>()

const where = computed(() => {
  if (asset.source === 'cloud') return (proto.projects && asset.project) || 'Comfy Cloud'
  const f = localFolders.value.find((x) => x.id === asset.folderId)
  if (!f) return 'This computer'
  return f.instanceId ? `${instanceById(f.instanceId)?.name} · ${f.name}` : f.name
})
// Deterministic pseudo waveform for audio tiles.
const bars = computed(() =>
  Array.from({ length: 28 }, (_, i) => 20 + ((i * 37 + asset.name.length * 7) % 60))
)
</script>

<template>
  <MediaCard
    ratio="1/1"
    :src="asset.thumbId ? thumb(asset.thumbId) : undefined"
    :selected
    :aria-label="asset.name"
    @click="selecting ? emit('toggle') : emit('open')"
    @keydown.enter="selecting ? emit('toggle') : emit('open')"
  >
    <template v-if="asset.type === 'audio'" #media>
      <div class="flex size-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Music :size="18" />
        <span class="flex h-8 w-3/4 items-center gap-0.5">
          <i
            v-for="(h, i) in bars"
            :key="i"
            class="flex-1 rounded-[1px] bg-white/30"
            :style="{ height: `${h}%` }"
          />
        </span>
      </div>
    </template>

    <template #top-left>
      <Checkbox
        variant="overlay"
        :model-value="selected"
        :aria-label="`Select ${asset.name}`"
        :class="
          !selected && !selecting
            ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            : ''
        "
        @update:model-value="emit('toggle')"
        @click.stop
      />
    </template>
    <template v-if="asset.source === 'cloud'" #top-right><CloudDownloadMenu :asset /></template>
    <template v-if="asset.type === 'video' || asset.type === '3d'" #bottom-right>
      <Badge variant="overlay" size="md" class="px-1.5" :aria-label="asset.type">
        <Play v-if="asset.type === 'video'" :size="11" /><Box v-else :size="11" />
      </Badge>
    </template>

    <p class="truncate text-ui font-medium">{{ asset.name }}</p>
    <p class="truncate text-ui text-subtle-foreground">{{ where }} · {{ asset.when }}</p>
  </MediaCard>
</template>
