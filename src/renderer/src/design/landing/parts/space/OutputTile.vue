<script setup lang="ts">
import { computed } from 'vue'
import { Download, Star } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import MediaCard from '../../ui/MediaCard.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { spaceById, type Space, type SpaceOutput } from '../../spaces'
import { toast } from '../../useProto'
import { thumb } from '../../mock'

/** A result in a client space. Downloads follow the space's policies:
 *  review before download, watermark, downloads off. */
const { out, space } = defineProps<{ out: SpaceOutput; space: Space }>()
function toggleFav(): void {
  const own = spaceById(space.id)?.library.find((o) => o.id === out.id)
  if (own) own.fav = !own.fav
}
const STATUS = { review: 'In review', changes: 'Changes requested' } as const
const blocked = computed(() =>
  !space.policies.downloads
    ? 'Downloads are off in this space'
    : out.status !== 'approved'
      ? 'Available once approved'
      : ''
)
</script>

<template>
  <MediaCard :src="thumb(out.thumbId)" ratio="1/1" @click="toast(`Open ${out.tool} result`)">
    <template v-if="out.status !== 'approved'" #top-left>
      <Badge variant="overlay" size="md">{{ STATUS[out.status] }}</Badge>
    </template>
    <template #top-right>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="out.fav ? 'Unfavourite' : 'Favourite'"
        class="bg-media-overlay backdrop-blur-sm"
        @click.stop="toggleFav"
        ><Star :size="12" :class="out.fav && 'fill-current'"
      /></Button>
    </template>
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <p class="truncate text-ui font-medium">{{ out.tool }}</p>
        <p class="truncate text-ui text-subtle-foreground">{{ out.by }} · {{ out.when }}</p>
      </div>
      <Tooltip
        :content="blocked || (space.policies.watermark ? 'Download (watermarked)' : 'Download')"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Download"
          :disabled="!!blocked"
          @click.stop="toast('Downloading…')"
          ><Download :size="13"
        /></Button>
      </Tooltip>
    </div>
  </MediaCard>
</template>
