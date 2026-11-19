<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-vue-next'
import type { SNode } from './canvasData'

/**
 * A result, large: double-click a node's picture or clip. Its earlier
 * results run along the bottom, tagged by their run; arrows step through
 * them and Escape closes.
 */
const { node } = defineProps<{ node: SNode }>()
const emit = defineEmits<{ close: []; pick: [index: number]; save: [] }>()

const items = computed(() => (node.history.length ? node.history : [{ src: node.image, run: 0 }]))
const at = computed(() => Math.min(node.pick, items.value.length - 1))
const src = computed(() => items.value[at.value]?.src ?? node.image)
const isVideo = computed(() => !!node.video && !node.history.length)

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowLeft' && at.value > 0) emit('pick', at.value - 1)
  else if (e.key === 'ArrowRight' && at.value < items.value.length - 1) emit('pick', at.value + 1)
  else return
  e.preventDefault()
  e.stopPropagation()
}
onMounted(() => window.addEventListener('keydown', key, true))
onBeforeUnmount(() => window.removeEventListener('keydown', key, true))
</script>

<template>
  <div
    class="mv"
    role="dialog"
    :aria-label="node.title"
    @pointerdown.self="emit('close')"
    @wheel.stop
  >
    <header class="mv-head">
      <span class="mv-title">{{ node.title }}</span>
      <span v-if="items[at]?.run" class="mv-run">Run {{ items[at]!.run }}</span>
      <span class="mv-gap" />
      <button type="button" class="mv-btn" @click="emit('save')">
        <Download :size="14" />Save to Assets
      </button>
      <button type="button" class="mv-btn is-icon" aria-label="Close" @click="emit('close')">
        <X :size="16" />
      </button>
    </header>
    <div class="mv-stage" @pointerdown.self="emit('close')">
      <button
        v-if="items.length > 1"
        type="button"
        class="mv-arrow"
        aria-label="Earlier result"
        :disabled="at === 0"
        @click="emit('pick', at - 1)"
      >
        <ChevronLeft :size="18" />
      </button>
      <video v-if="isVideo" :src="node.video" class="mv-media" autoplay muted loop playsinline />
      <img v-else :key="src" :src="src" alt="" class="mv-media" draggable="false" />
      <button
        v-if="items.length > 1"
        type="button"
        class="mv-arrow is-right"
        aria-label="Later result"
        :disabled="at === items.length - 1"
        @click="emit('pick', at + 1)"
      >
        <ChevronRight :size="18" />
      </button>
    </div>
    <div v-if="items.length > 1" class="mv-strip">
      <button
        v-for="(r, i) in items"
        :key="i"
        type="button"
        class="mv-thumb"
        :class="i === at && 'is-on'"
        :aria-label="`Run ${r.run}`"
        @click="emit('pick', i)"
      >
        <img :src="r.src" alt="" draggable="false" />
      </button>
    </div>
  </div>
</template>

<style>
.mv {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  padding: calc(var(--mg-top) + 16px) 24px 20px;
  background: color-mix(in oklch, var(--color-content-background) 88%, transparent);
  backdrop-filter: blur(28px);
  color: var(--mg-text);
  animation: mv-in 0.18s ease-out;
}
@keyframes mv-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mv {
    animation: none;
  }
}
.mv-head {
  display: flex;
  height: 40px;
  flex: none;
  align-items: center;
  gap: 10px;
}
.mv-title {
  font-size: 14px;
  font-weight: 500;
}
.mv-run {
  color: var(--mg-dim);
  font-size: 12px;
}
.mv-gap {
  flex: 1;
}
:root .proto-ui.proto-ui.proto-ui .mv-btn {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--mar-tab-item-radius);
  background: var(--mg-hover);
  color: var(--mg-text);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mv-btn.is-icon {
  width: 32px;
  justify-content: center;
  padding: 0;
  background: transparent;
}
.mv-stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px 0;
}
.mv-media {
  max-width: calc(100% - 120px);
  max-height: 100%;
  border-radius: var(--mar-tab-radius);
  object-fit: contain;
}
:root .proto-ui.proto-ui.proto-ui .mv-arrow {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: var(--mg-hover);
  color: var(--mg-text);
}
:root .proto-ui.proto-ui.proto-ui .mv-arrow:disabled {
  opacity: 0.3;
}
.mv-strip {
  display: flex;
  flex: none;
  justify-content: center;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .mv-thumb {
  width: 52px;
  height: 52px;
  padding: 0;
  overflow: hidden;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  opacity: 0.5;
}
:root .proto-ui.proto-ui.proto-ui .mv-thumb.is-on {
  box-shadow: 0 0 0 2px var(--mg-text);
  opacity: 1;
}
.mv-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
