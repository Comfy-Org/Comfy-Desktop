<script setup lang="ts">
import type { Component } from 'vue'
import { Plus } from 'lucide-vue-next'
import { brandMotif } from '../brand/brandMotif'
import MarTrio from '../brand/MarTrio.vue'

/**
 * The "New …" tile that ends a library grid (Mar's pages). Built like a
 * card (MarItem): the same surface, a picture area at the cards' ratio
 * and a caption under it, so it sits in the grid as one of them. The
 * picture area is an empty, dashed slot holding + and the label; a
 * second way in (e.g. Import a file) is a quiet action in the caption.
 * With the brand motif on, the trio holds the + in its open slab.
 */
const {
  label,
  altLabel,
  altIcon,
  ratio = '16 / 10'
} = defineProps<{
  label: string
  altLabel?: string
  altIcon?: Component
  ratio?: string
}>()
const emit = defineEmits<{ create: []; alt: [] }>()
</script>

<template>
  <div class="mar-add-tile">
    <button
      type="button"
      class="mar-add-main"
      :class="brandMotif.id === 'trio' && 'mar-trio-host'"
      :style="{ aspectRatio: ratio }"
      @click="emit('create')"
    >
      <MarTrio v-if="brandMotif.id === 'trio'" :u="22" :icon="Plus" :icon-size="12" />
      <span v-else class="mar-add-plus"><Plus :size="18" /></span>
      <span class="mar-add-label">{{ label }}</span>
    </button>
    <span class="mar-add-caption">
      <button v-if="altLabel" type="button" class="mar-add-alt" @click="emit('alt')">
        <component :is="altIcon" v-if="altIcon" :size="13" />{{ altLabel }}
      </button>
    </span>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-add-tile {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 4px;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-card-background) 40%, transparent);
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-add-tile:has(.mar-add-main:hover) {
  background: color-mix(in oklch, var(--color-card-background-hover) 60%, transparent);
}
/* The picture area: an empty slot, dashed, the size every card's picture is. */
:root .proto-ui.proto-ui.proto-ui .mar-add-main {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0;
  border: 1.5px dashed color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 2.5%, transparent);
  color: var(--color-muted-foreground);
  outline: none;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-add-main:hover {
  border-color: color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-add-main:active {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-add-main:focus-visible {
  border-color: transparent;
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-add-plus {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  transition:
    background-color 160ms ease,
    transform 160ms ease;
}
.mar-add-main:hover .mar-add-plus {
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  transform: scale(1.06);
}
.mar-add-main:active .mar-add-plus {
  transform: scale(0.97);
}
.mar-add-label {
  font-size: 13px;
  font-weight: 500;
}
/* The caption: the same room a card gives its name and meta line. */
.mar-add-caption {
  display: flex;
  min-height: 52px;
  align-items: flex-start;
  padding: 6px 4px 4px;
}
:root .proto-ui.proto-ui.proto-ui .mar-add-alt {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
  outline: none;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-add-alt:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-add-alt:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
@media (prefers-reduced-motion: reduce) {
  .mar-add-plus {
    transition: none;
  }
  .mar-add-main:is(:hover, :active) .mar-add-plus {
    transform: none;
  }
}
</style>
