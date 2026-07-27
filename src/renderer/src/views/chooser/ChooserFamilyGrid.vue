<script setup lang="ts">
/**
 * One grid of chooser tiles — the shared body of every shelf.
 *
 * Renders the New Install tile, install tiles and distribution cards from a
 * mixed entry list and re-emits every tile event verbatim; `ChooserView` owns
 * all the handlers, so the two families cannot drift in behaviour just because
 * they sit in different shelves.
 *
 * `centered` is the shipped single-cluster look, used when there's no shelf
 * beneath. Under a shelf header the rows go left-aligned, so tiles line up
 * with the header that names them.
 */
import { useI18n } from 'vue-i18n'
import { Plus } from 'lucide-vue-next'
import ChooserInstallTile from './ChooserInstallTile.vue'
import DevPlatformDistributionCard from '../devplatform/DevPlatformDistributionCard.vue'
import { entryKey, type ChooserGridEntry } from './chooserGridEntry'
import type { Distribution } from '../../devplatform/types'
import type { Installation } from '../../types/ipc'

const props = withDefaults(
  defineProps<{
    entries: ChooserGridEntry[]
    /** Lead with the New Install tile (the your-installs family owns it). */
    showNew?: boolean
    /** Center the rows instead of left-aligning them under a shelf header. */
    centered?: boolean
    isStoppedActionGated: (inst: Installation) => boolean
  }>(),
  { showNew: false, centered: false }
)

const emit = defineEmits<{
  'new-install': []
  pick: [installation: Installation]
  'open-card-menu': [event: MouseEvent, installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
  'dist-select': [distribution: Distribution]
  'dist-kebab': [event: MouseEvent, distribution: Distribution]
}>()

const { t } = useI18n()

/** Freeze a leaving tile's box so it doesn't collapse under `position:
 *  absolute`, letting survivors FLIP into the gap immediately. */
function lockLeavingTileSize(el: Element): void {
  const node = el as HTMLElement
  const grid = node.parentElement
  if (!grid) return
  const rect = node.getBoundingClientRect()
  const gridRect = grid.getBoundingClientRect()
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
  node.style.left = `${rect.left - gridRect.left + grid.scrollLeft}px`
  node.style.top = `${rect.top - gridRect.top + grid.scrollTop}px`
}
</script>

<template>
  <TransitionGroup
    tag="div"
    name="tile"
    class="chooser-family-grid"
    :class="{ 'chooser-family-grid--centered': props.centered }"
    @before-leave="lockLeavingTileSize"
  >
    <button
      v-if="props.showNew"
      key="__new"
      type="button"
      class="chooser-tile chooser-tile-new"
      @click="emit('new-install')"
    >
      <div class="chooser-tile-icon"><Plus :size="32" /></div>
      <div class="chooser-tile-name">{{ t('chooser.newInstall') }}</div>
      <div class="chooser-tile-meta">{{ t('chooser.newInstallDesc') }}</div>
    </button>

    <template v-for="entry in props.entries" :key="entryKey(entry)">
      <ChooserInstallTile
        v-if="entry.kind === 'install'"
        :installation="entry.inst"
        :is-stopped-action-gated="props.isStoppedActionGated(entry.inst)"
        @pick="emit('pick', $event)"
        @open-card-menu="(event, inst) => emit('open-card-menu', event, inst)"
        @open-kebab-menu="(event, inst) => emit('open-kebab-menu', event, inst)"
        @trigger-action="(action, inst) => emit('trigger-action', action, inst)"
        @view-error="emit('view-error', $event)"
        @view-danger="emit('view-danger', $event)"
      />
      <DevPlatformDistributionCard
        v-else
        :distribution="entry.dist"
        @select="emit('dist-select', entry.dist)"
        @open-kebab-menu="(event) => emit('dist-kebab', event, entry.dist)"
      />
    </template>
  </TransitionGroup>
</template>

<style scoped>
@import './chooser-tiles.css';

.chooser-family-grid {
  /* Containing block for absolutely-positioned leaving tiles. */
  position: relative;
  width: 100%;
  display: grid;
  /* Fixed-width tracks instead of `auto-fill` `minmax(...)`: with `auto-fill`
   * the grid reserves blank tracks across the full width, leaving 1-3 cards
   * stuck at the left edge. Fixed tracks wrap honestly. */
  grid-template-columns: repeat(auto-fit, 280px);
  justify-content: start;
  gap: 16px;
  align-content: start;
}
.chooser-family-grid--centered {
  justify-content: center;
}

/* Tile FLIP. */
.tile-enter-active {
  transition:
    opacity 200ms ease,
    transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.tile-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
.tile-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms cubic-bezier(0.32, 0.72, 0, 1);
  position: absolute;
}
.tile-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
.tile-move {
  transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  .tile-enter-active,
  .tile-leave-active,
  .tile-move {
    transition-duration: 1ms;
  }
  .tile-enter-from,
  .tile-leave-to {
    transform: none;
  }
}
</style>
