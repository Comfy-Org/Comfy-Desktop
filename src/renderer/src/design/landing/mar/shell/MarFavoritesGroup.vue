<script setup lang="ts">
import { computed } from 'vue'
import { Star } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { cn } from '../../ui/cn'
import { go, proto } from '../../useProto'
import { favoriteItems, type FavoriteItem } from '../favoriteItems'
import { toggleFavorite } from '../favorites'
import MarGroupTitle from './MarGroupTitle.vue'

/** Favorites in the sidebar (Mar's proposal), rescued from her usertest-home
 *  prototype: what you starred, one click away. Rows read like the Projects
 *  and Spaces rows; like them, the title opens the whole page, which is
 *  where anything past the first four lives. A new star slides in; hover a
 *  row to unstar it. Hidden while nothing is starred. */
const MAX = 4
const rows = computed(() => favoriteItems.value.slice(0, MAX))

function isActive(f: FavoriteItem): boolean {
  if (f.kind === 'app') return proto.page === `app:${f.id}`
  return f.kind === 'template' && proto.detail?.kind === 'template' && proto.detail.id === f.id
}
const itemClass = (active: boolean): string =>
  cn(
    'h-8 w-full justify-start gap-2.5 pr-9 pl-3 text-ui font-normal',
    active && 'bg-secondary-background-hover text-base-foreground'
  )
</script>

<template>
  <!-- No favorites, no group: it appears with the first star and goes
       with the last. -->
  <div v-if="rows.length" class="mt-5.5 flex shrink-0 flex-col">
    <div class="flex h-6.5 items-center justify-between pr-1 pl-3">
      <MarGroupTitle
        title="Favorites"
        :active="proto.page === 'favorites'"
        @click="go('favorites')"
      />
    </div>

    <TransitionGroup name="mar-fav">
      <div v-for="f in rows" :key="f.key" class="mar-fav-row relative">
        <Button
          variant="ghost"
          :aria-current="isActive(f) ? 'page' : undefined"
          :class="itemClass(isActive(f))"
          @click="f.open()"
        >
          <img v-if="f.src" :src="f.src" alt="" class="mar-fav-thumb" />
          <Star v-else :size="15" />
          <span class="sidebar-label text-left">{{ f.title }}</span>
        </Button>
        <Tooltip content="Remove from favorites">
          <Button
            variant="ghost"
            size="icon-xs"
            class="mar-fav-unstar"
            :aria-label="`Remove ${f.title} from favorites`"
            @click="toggleFavorite(f.id, f.kind)"
            ><Star :size="13" fill="currentColor"
          /></Button>
        </Tooltip>
      </div>
    </TransitionGroup>
  </div>
</template>

<style>
.mar-fav-thumb {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: cover;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
}
/* Unstar sits on the row's right edge, shown on hover or keyboard focus. */
.mar-fav-row .mar-fav-unstar {
  position: absolute;
  top: 50%;
  right: 6px;
  color: var(--color-subtle-foreground);
  opacity: 0;
  transform: translateY(-50%);
  transition:
    opacity 120ms ease,
    color 120ms ease;
}
.mar-fav-row:hover .mar-fav-unstar,
.mar-fav-row .mar-fav-unstar:focus-visible {
  opacity: 1;
}
.mar-fav-row .mar-fav-unstar:hover {
  color: var(--color-base-foreground);
}
.mar-fav-enter-active {
  transition:
    opacity 220ms ease,
    transform 320ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-fav-leave-active {
  transition: opacity 150ms ease;
}
.mar-fav-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.mar-fav-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .mar-fav-enter-active {
    transition: opacity 150ms ease;
  }
  .mar-fav-enter-from {
    transform: none;
  }
}
</style>
