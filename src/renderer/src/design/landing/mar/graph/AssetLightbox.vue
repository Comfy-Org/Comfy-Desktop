<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { thumb } from '../../mock'
import AssetCover from '../assets/AssetCover.vue'
import type { MarAsset } from '../pages/assetsStore'

/**
 * Double-click on an asset, as ComfyUI ships it: the file large over the
 * window, arrows through the list, Escape or X back to where you were.
 * Nothing else on it; the details are Inspect asset's, in the side panel.
 */
const { asset, list } = defineProps<{ asset: MarAsset; list: MarAsset[] }>()
const emit = defineEmits<{ close: []; go: [asset: MarAsset] }>()

const at = computed(() => list.findIndex((a) => a.id === asset.id))
const prev = computed(() => list[at.value - 1])
const next = computed(() => list[at.value + 1])
const pic = computed(() => asset.src ?? (asset.thumbId ? thumb(asset.thumbId) : undefined))

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowLeft' && prev.value) emit('go', prev.value)
  else if (e.key === 'ArrowRight' && next.value) emit('go', next.value)
  else return
  e.preventDefault()
  e.stopPropagation()
}
onMounted(() => window.addEventListener('keydown', key, true))
onBeforeUnmount(() => window.removeEventListener('keydown', key, true))
</script>

<template>
  <Teleport to="body">
    <div
      class="proto-ui alb"
      role="dialog"
      aria-modal="true"
      :aria-label="asset.name"
      @pointerdown.self="emit('close')"
    >
      <button type="button" class="alb-btn alb-x" aria-label="Close" @click="emit('close')">
        <X :size="18" />
      </button>
      <button
        type="button"
        class="alb-btn alb-arrow"
        aria-label="Previous asset"
        :disabled="!prev"
        @click="prev && emit('go', prev)"
      >
        <ChevronLeft :size="20" />
      </button>
      <figure class="alb-media" @pointerdown.self="emit('close')">
        <img v-if="pic" :key="asset.id" :src="pic" :alt="asset.name" />
        <AssetCover v-else :name="asset.name" :type="asset.type" />
        <figcaption>{{ asset.name }} · {{ at + 1 }} / {{ list.length }}</figcaption>
      </figure>
      <button
        type="button"
        class="alb-btn alb-arrow is-right"
        aria-label="Next asset"
        :disabled="!next"
        @click="next && emit('go', next)"
      >
        <ChevronRight :size="20" />
      </button>
    </div>
  </Teleport>
</template>

<style>
.alb {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 64px;
  align-items: center;
  background: rgb(0 0 0 / 0.86);
  color: #f2f2f2;
}
.alb-media {
  display: grid;
  min-width: 0;
  height: 100%;
  margin: 0;
  place-items: center;
  align-content: center;
  gap: 12px;
  padding: 48px 0;
}
.alb-media img {
  max-width: 100%;
  max-height: calc(100vh - 140px);
  border-radius: 4px;
  object-fit: contain;
}
.alb-media figcaption {
  color: rgb(255 255 255 / 0.7);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .alb-btn {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
  color: #f2f2f2;
}
:root .proto-ui.proto-ui.proto-ui .alb-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.16);
}
:root .proto-ui.proto-ui.proto-ui .alb-btn:disabled {
  opacity: 0.3;
}
.alb-arrow {
  justify-self: center;
}
.alb-x {
  position: absolute;
  top: 16px;
  right: 16px;
}
</style>
