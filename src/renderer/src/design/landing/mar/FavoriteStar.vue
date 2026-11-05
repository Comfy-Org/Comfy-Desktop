<script setup lang="ts">
import { Star } from 'lucide-vue-next'
import { isFavorite, toggleFavorite, type FavoriteKind } from './favorites'
import { can } from '../milestones'

/** The star in a card's corner: shows on hover, stays once starred.
 *  Templates, apps and assets can be starred, from Explore on. */
const { id, kind = 'template' } = defineProps<{ id: string; kind?: FavoriteKind }>()
</script>

<template>
  <button
    v-if="can.exploreApps"
    type="button"
    class="mar-star"
    :class="isFavorite(id, kind) && 'is-on'"
    :aria-pressed="isFavorite(id, kind)"
    :aria-label="isFavorite(id, kind) ? 'Remove from favorites' : 'Add to favorites'"
    @click.stop="toggleFavorite(id, kind)"
    @keydown.enter.stop
  >
    <Star :size="13" :fill="isFavorite(id, kind) ? 'currentColor' : 'none'" />
  </button>
</template>

<style>
/* Global: the star answers to its card's hover. */
:root .proto-ui.proto-ui.proto-ui .mar-star {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  opacity: 0;
  transition: opacity 160ms ease;
}
:root
  .proto-ui.proto-ui.proto-ui
  :is(.group:hover .mar-star, .mar-star:focus-visible, .mar-star.is-on) {
  opacity: 1;
}
</style>
