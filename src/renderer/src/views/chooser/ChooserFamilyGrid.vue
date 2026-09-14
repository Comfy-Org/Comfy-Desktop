<script setup lang="ts">
/** One grid of installed instances for the selected dashboard scope. */
import { useI18n } from 'vue-i18n'
import { Plus } from 'lucide-vue-next'
import ChooserInstallTile from './ChooserInstallTile.vue'
import type { Installation } from '../../types/ipc'

const props = withDefaults(
  defineProps<{
    installations: Installation[]
    /** Lead with the New Install tile. */
    showNew?: boolean
    showFreeRunsPill?: boolean
    showWhyCloud?: boolean
    isStoppedActionGated: (inst: Installation) => boolean
    isPromotingToWorkspace?: (inst: Installation) => boolean
  }>(),
  {
    showNew: false,
    showFreeRunsPill: false,
    showWhyCloud: false,
    isPromotingToWorkspace: () => false
  }
)

const emit = defineEmits<{
  'new-install': []
  pick: [installation: Installation]
  'open-card-menu': [event: MouseEvent, installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
  'why-cloud': []
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

/** Drop the locked box when a leaving tile is reinserted (leave cancelled):
 *  Vue reuses the DOM node, and `.tile-leave-active` no longer applies, so a
 *  stale inline width/height would otherwise freeze the revived tile's size. */
function unlockTileSize(el: Element): void {
  const node = el as HTMLElement
  node.style.removeProperty('width')
  node.style.removeProperty('height')
  node.style.removeProperty('left')
  node.style.removeProperty('top')
}
</script>

<template>
  <TransitionGroup
    tag="div"
    name="tile"
    class="chooser-family-grid"
    @before-leave="lockLeavingTileSize"
    @leave-cancelled="unlockTileSize"
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

    <ChooserInstallTile
      v-for="installation in props.installations"
      :key="`install:${installation.id}`"
      :installation="installation"
      :show-free-runs-pill="props.showFreeRunsPill && installation.sourceCategory === 'cloud'"
      :show-why-cloud="props.showWhyCloud && installation.sourceCategory === 'cloud'"
      :is-stopped-action-gated="props.isStoppedActionGated(installation)"
      :is-promoting-to-workspace="props.isPromotingToWorkspace(installation)"
      @why-cloud="emit('why-cloud')"
      @pick="emit('pick', $event)"
      @open-card-menu="(event, inst) => emit('open-card-menu', event, inst)"
      @open-kebab-menu="(event, inst) => emit('open-kebab-menu', event, inst)"
      @trigger-action="(action, inst) => emit('trigger-action', action, inst)"
      @view-error="emit('view-error', $event)"
      @view-danger="emit('view-danger', $event)"
    />
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
