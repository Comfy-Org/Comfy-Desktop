<script setup lang="ts">
import { Star } from 'lucide-vue-next'
import MarStatus from '../../pages/MarStatus.vue'
import MarSidebar from '../../shell/MarSidebar.vue'
// Their stylesheets, which the app loads with the component.
import '../../search/search.css'
import '../../templateModal/templateModal.css'
import '../../pages/MarSelectBar.vue'
import '../../pages/MarItem.vue'
import '../../pages/MarUndoToast.vue'
import '../../FavoriteStar.vue'

/**
 * One material, built with the selectors the app uses (so it takes the
 * app's real CSS), marked `data-glass` for the readout. Elements the app
 * places `fixed` are put back in the flow here; nothing else is set.
 */
defineProps<{ id: string }>()

// MarSidebar's style is scoped: its attribute lets this sample match it.
const sideScope = { [(MarSidebar as { __scopeId?: string }).__scopeId ?? 'data-x']: '' }
const inFlow = { position: 'relative', inset: 'auto', transform: 'none' } as const
</script>

<template>
  <div v-if="id === 'menu'" role="menu" data-glass="menu" class="ds-glass-menu">
    <div role="menuitem" class="ds-glass-row">Open in Cloud</div>
    <div role="menuitem" class="ds-glass-row">Duplicate</div>
    <div role="menuitem" class="ds-glass-row">Move to space</div>
  </div>
  <div
    v-else-if="id === 'palette'"
    data-glass="palette"
    class="mar-search"
    :style="{ width: '100%', padding: '14px 16px' }"
  >
    Search templates, workflows, spaces…
  </div>
  <div v-else-if="id === 'tooltip'" data-glass="tooltip" class="mar-tip">Open in Cloud ⌘O</div>
  <div
    v-else-if="id === 'modal'"
    data-glass="modal"
    class="mar-tpl"
    :style="{ ...inFlow, display: 'block', width: '100%', height: 'auto', padding: '16px' }"
  >
    <strong>Portrait relight</strong><br />Runs on Cloud · 4 models
  </div>
  <div
    v-else-if="id === 'scrim'"
    data-glass="scrim"
    class="mar-tpl-scrim"
    :style="{ position: 'absolute', inset: 0, zIndex: 0, borderRadius: 'inherit' }"
  />
  <div v-else-if="id === 'bar'" class="proto-ui">
    <div data-glass="bar" class="mar-selbar" :style="{ ...inFlow, bottom: 'auto', left: 'auto' }">
      <span class="mar-selbar-n">3 selected</span>
    </div>
  </div>
  <div v-else-if="id === 'chip'" class="ds-glass-chips">
    <MarStatus data-glass="chip" status="executing" on-media />
    <button type="button" class="mar-star is-on" aria-label="Favorite">
      <Star :size="13" />
    </button>
  </div>
  <div
    v-else-if="id === 'composer'"
    data-glass="composer"
    class="mar-prompt bg-card-background rounded-panel ds-glass-box"
  >
    Describe what to make…
  </div>
  <div v-else-if="id === 'control'" class="ds-glass-control">
    <span class="mar-backdrop" :style="{ display: 'none' }" />
    <div>
      <div role="group" data-glass="control" class="bg-secondary-background ds-glass-field">
        All types
      </div>
    </div>
  </div>
  <div
    v-else-if="id === 'card'"
    data-glass="card"
    class="bg-card-background rounded-card ds-glass-box"
  >
    Product shots<br /><span class="text-muted-foreground">Edited 2h ago</span>
  </div>
  <div
    v-else-if="id === 'panel'"
    data-glass="panel"
    class="mar-side"
    v-bind="sideScope"
    :style="{ ...inFlow, width: '100%', height: 'auto', zIndex: 0 }"
  >
    Home<br />Workflows<br />Assets
  </div>
  <div v-else-if="id === 'titlebar'" class="proto-ui ds-glass-titlebar-host">
    <div data-glass="titlebar" class="glass-titlebar ds-glass-titlebar">My builds › Local</div>
  </div>
  <!-- mar/pages/MarUndoToast.vue, in place. -->
  <div v-else-if="id === 'toast'" class="proto-ui">
    <div data-glass="toast" class="mar-undo is-success is-still">Saved to Assets</div>
  </div>
</template>

<style>
.ds-glass-menu {
  width: 100%;
}
.ds-glass-row {
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13px;
}
.ds-glass-chips {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ds-glass-box {
  width: 100%;
  padding: 12px 14px;
  font-size: 13px;
}
.ds-glass-control,
.ds-glass-control > div {
  width: 100%;
}
.ds-glass-field {
  display: flex;
  height: 32px;
  align-items: center;
  padding: 0 12px;
  border-radius: var(--mar-tab-radius, 10px);
  font-size: 13px;
}
.ds-glass-titlebar-host {
  width: 100%;
}
.ds-glass-titlebar {
  display: flex;
  height: 36px;
  align-items: center;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 12px;
}
</style>
