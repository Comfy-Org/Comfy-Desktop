<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { Check, Star, Users } from 'lucide-vue-next'
import FavoriteStar from '../FavoriteStar.vue'
import type { FavoriteKind } from '../favorites'
import MarItemMenu from './MarItemMenu.vue'
import MarStatus, { type ItemStatus } from './MarStatus.vue'
import type { MenuLine } from './menu'
import '../table/table.css'

/**
 * One thing in a library (Mar's pages), as a card or a list row. Click
 * opens it; ⌘/Ctrl- or Shift-click, or the checkbox, selects it, and
 * once anything is selected a plain click selects too. `selectable`
 * false (Builds) drops all of that: no check, a click always opens. Double-click the
 * name (or Rename in ⋯) to rename it in place. The card never grows on
 * hover; its surface lifts a shade and the controls show.
 *
 * Corners of a card's picture: top-left is the select check's, always;
 * top-right holds the star and ⋯; a state chip sits bottom-left. Shared
 * is not a state on a card: it reads as a small icon on the meta line,
 * so nothing moves when the check appears.
 */
const {
  name,
  thumb,
  icon,
  meta,
  status,
  statusLabel,
  layout = 'grid',
  selected = false,
  selecting = false,
  selectable = true,
  renaming = false,
  fav,
  favId,
  favKind,
  lines,
  ratio = '16 / 10',
  fit = 'cover',
  contextMenu = false
} = defineProps<{
  name: string
  thumb?: string
  icon?: Component
  meta?: string
  status?: ItemStatus
  statusLabel?: string
  layout?: 'grid' | 'list'
  selected?: boolean
  /** Something on the page is selected: clicks select. */
  selecting?: boolean
  /** False: no check and no selecting, a click always opens. */
  selectable?: boolean
  renaming?: boolean
  /** Local star (things the favourites store doesn't keep). */
  fav?: boolean
  /** Star through the shared favourites store. */
  favId?: string
  favKind?: FavoriteKind
  lines: MenuLine[]
  ratio?: string
  fit?: 'cover' | 'contain'
  /** Right-click opens the ⋯ menu (Builds). */
  contextMenu?: boolean
}>()
const emit = defineEmits<{
  open: []
  select: [range: boolean]
  rename: [name: string]
  'cancel-rename': []
  'start-rename': []
  star: []
}>()

const menuOpen = ref(false)
const isSharedCard = computed(() => layout === 'grid' && status === 'shared')
const draft = ref(name)
const input = ref<HTMLInputElement>()
watch(
  () => renaming,
  async (on) => {
    if (!on) return
    draft.value = name
    await nextTick()
    // After the ⋯ menu has closed and handed focus back to its button.
    setTimeout(() => {
      input.value?.focus()
      input.value?.select()
    }, 60)
  },
  { immediate: true }
)
let done = false
function commit(): void {
  if (done) return
  done = true
  emit('rename', draft.value)
  setTimeout(() => (done = false))
}
function cancel(): void {
  done = true
  emit('cancel-rename')
  setTimeout(() => (done = false))
}

function click(e: MouseEvent): void {
  if (renaming) return
  if (selectable && (e.metaKey || e.ctrlKey || e.shiftKey || selecting)) emit('select', e.shiftKey)
  else emit('open')
}
</script>

<template>
  <div
    class="mar-item"
    :class="[
      `is-${layout}`,
      selectable && 'is-selectable',
      selected && 'is-selected',
      menuOpen && 'is-menu',
      selecting && 'is-selecting'
    ]"
    role="button"
    tabindex="0"
    :aria-label="name"
    :aria-pressed="selectable && selecting ? selected : undefined"
    @click="click"
    @contextmenu="contextMenu && lines.length && ($event.preventDefault(), (menuOpen = true))"
    @keydown.enter.self="emit('open')"
    @keydown.space.self.prevent="selectable && emit('select', false)"
  >
    <span class="mar-item-media" :style="layout === 'grid' ? { aspectRatio: ratio } : undefined">
      <slot name="media">
        <img
          v-if="thumb"
          :src="thumb"
          alt=""
          loading="lazy"
          :class="fit === 'contain' && 'is-contain'"
        />
        <span v-else class="mar-item-glyph"
          ><component :is="icon" :size="layout === 'grid' ? 28 : 18"
        /></span>
      </slot>
      <template v-if="layout === 'grid'">
        <span v-if="status && status !== 'shared'" class="mar-item-status"
          ><MarStatus :status :label="statusLabel" on-media
        /></span>
        <span class="mar-item-tools">
          <FavoriteStar v-if="favId && favKind" :id="favId" :kind="favKind" />
          <button
            v-else-if="fav !== undefined"
            type="button"
            class="mar-star"
            :class="fav && 'is-on'"
            :aria-pressed="fav"
            :aria-label="fav ? 'Remove from favorites' : 'Add to favorites'"
            @click.stop="emit('star')"
          >
            <Star :size="13" :fill="fav ? 'currentColor' : 'none'" />
          </button>
          <MarItemMenu v-model:open="menuOpen" :lines on-media />
        </span>
        <slot name="overlay" />
      </template>
    </span>

    <button
      v-if="selectable"
      type="button"
      class="mar-item-check"
      role="checkbox"
      :aria-checked="selected"
      :aria-label="selected ? `Deselect ${name}` : `Select ${name}`"
      @click.stop="emit('select', ($event as MouseEvent).shiftKey)"
    >
      <Check v-if="selected" :size="12" :stroke-width="3" />
    </button>

    <span class="mar-item-text">
      <slot name="eyebrow" />
      <input
        v-if="renaming"
        ref="input"
        v-model="draft"
        class="mar-item-rename"
        aria-label="Name"
        @click.stop
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commit"
      />
      <span v-else class="mar-item-name" @dblclick.stop="emit('start-rename')">{{ name }}</span>
      <span v-if="meta || $slots.meta || isSharedCard" class="mar-item-meta"
        ><span
          v-if="isSharedCard"
          class="mar-item-shared"
          role="img"
          aria-label="Shared"
          title="Shared"
          ><Users :size="12" aria-hidden="true" /></span
        ><slot name="meta">{{ meta }}</slot></span
      >
    </span>
    <!-- Grid cards only: anything that sits under the name (a button, a
         few facts); the page lays it out. -->
    <slot v-if="layout === 'grid'" name="footer" />

    <template v-if="layout === 'list'">
      <slot name="cols" />
      <span class="mar-item-col is-status"
        ><MarStatus v-if="status" :status :label="statusLabel"
      /></span>
      <span class="mar-item-tools is-row" :class="$slots.actions && 'has-actions'">
        <!-- The row's own buttons, always shown (Builds: Start, Stop, Update). -->
        <slot name="actions" />
        <FavoriteStar v-if="favId && favKind" :id="favId" :kind="favKind" />
        <button
          v-else-if="fav !== undefined"
          type="button"
          class="mar-star"
          :class="fav && 'is-on'"
          :aria-pressed="fav"
          :aria-label="fav ? 'Remove from favorites' : 'Add to favorites'"
          @click.stop="emit('star')"
        >
          <Star :size="13" :fill="fav ? 'currentColor' : 'none'" />
        </button>
        <MarItemMenu v-model:open="menuOpen" :lines />
      </span>
    </template>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-item {
  position: relative;
  display: flex;
  min-width: 0;
  cursor: default;
  outline: none;
  border-radius: var(--radius-card);
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
  -webkit-user-select: none;
  user-select: none;
}
.mar-item.is-grid {
  flex-direction: column;
  padding: 4px;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(20px);
}
.mar-item.is-list {
  height: 56px;
  align-items: center;
  gap: 14px;
  padding: 0 8px 0 10px;
  border-radius: 12px;
}
.mar-item.is-grid:hover,
.mar-item.is-grid.is-menu {
  background: color-mix(in oklch, var(--color-card-background-hover) 80%, transparent);
}
.mar-item.is-list:hover,
.mar-item.is-list.is-menu {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mar-item:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-item:active:not(:has(button:active)) {
  background: color-mix(in oklch, var(--color-card-background-hover) 95%, transparent);
}
.mar-item.is-selected {
  box-shadow: 0 0 0 2px var(--color-base-foreground);
}
.mar-item.is-list.is-selected {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  box-shadow: none;
}

.mar-item-media {
  position: relative;
  display: block;
  overflow: hidden;
  flex-shrink: 0;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.is-list .mar-item-media {
  width: 40px;
  height: 40px;
  border-radius: 9px;
}
.mar-item-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-item-media img.is-contain {
  object-fit: contain;
}
/* No picture yet (e.g. a new workflow): the canvas's dot grid, and the
   kind's icon on a small tile, so it reads as an empty graph, not a gap. */
.mar-item-glyph {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background-image: radial-gradient(
    color-mix(in oklch, var(--color-base-foreground) 14%, transparent) 1px,
    transparent 1.2px
  );
  background-size: 14px 14px;
  background-position: center;
  color: var(--color-muted-foreground);
}
.is-grid .mar-item-glyph > svg {
  box-sizing: content-box;
  padding: 14px;
  border-radius: var(--radius-control);
  background: var(--color-card-background);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
    0 8px 24px -10px rgb(0 0 0 / 0.5);
}
/* State sits bottom-left: top-left belongs to the select check, so the
   chip never has to step aside for it. */
.mar-item-status {
  position: absolute;
  bottom: 8px;
  left: 8px;
}
.mar-item-shared {
  display: inline-flex;
  flex-shrink: 0;
  margin-right: -2px;
  color: var(--color-muted-foreground);
}
.mar-item-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.mar-item-tools.is-row {
  position: static;
  margin-left: 4px;
}
.mar-item-tools .mar-kebab {
  opacity: 0;
}
.mar-item:is(:hover, :focus-within, .is-menu) .mar-item-tools :is(.mar-kebab, .mar-star) {
  opacity: 1;
}
/* A row with its own buttons ends on its ⋯, always shown, so the buttons
   reach the row's edge instead of stopping short of an invisible menu. */
.mar-item-tools.is-row.has-actions .mar-kebab {
  opacity: 1;
}
.mar-item-tools.is-row .mar-star {
  background: transparent;
  backdrop-filter: none;
  color: var(--color-muted-foreground);
}
.mar-item-tools.is-row .mar-star.is-on {
  color: oklch(0.85 0.15 85);
}

:root .proto-ui.proto-ui.proto-ui .mar-item-check {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1;
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.55);
  color: var(--color-inverted-foreground);
  opacity: 0;
  transition: opacity 140ms ease;
}
/* In a list the check sits on the thumbnail (no gutter of its own), so the
   row keeps a tight edge at rest and on hover. */
.is-list .mar-item-check {
  top: 18px !important;
  left: 20px !important;
}
.mar-item.is-list.is-selectable:is(:hover, :focus-within, .is-selecting, .is-selected)
  .mar-item-media
  img {
  opacity: 0.45;
}
/* Same weight as the reset that hides it, or the check never shows. */
:root
  .proto-ui.proto-ui.proto-ui
  .mar-item:is(:hover, :focus-within, .is-selecting, .is-selected)
  .mar-item-check {
  opacity: 1;
}
.mar-item.is-selected .mar-item-check {
  background: var(--color-inverted-background) !important;
  box-shadow: none !important;
}

.mar-item-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.is-grid .mar-item-text {
  padding: 10px 8px 8px;
}
.is-list .mar-item-text {
  flex: 1;
}
.mar-item-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-item-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Rename in place: the name itself becomes editable, on a lifted field
   with a soft ring; selection stays neutral, not browser blue. */
:root .proto-ui.proto-ui.proto-ui .mar-item-rename {
  width: calc(100% + 12px);
  height: 26px;
  margin: -4px -6px;
  padding: 0 6px;
  border: 0;
  border-radius: calc(var(--radius-control) - 4px);
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 22%, transparent),
    0 0 0 3px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  outline: none;
}
.mar-item-rename::selection {
  background: color-mix(in oklch, var(--color-base-foreground) 26%, transparent);
}
.mar-item-col {
  flex-shrink: 0;
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-item-col.is-status {
  display: flex;
  width: 150px;
  justify-content: flex-end;
}
.mar-item.is-list .mar-star {
  opacity: 0;
}
.mar-item.is-list :is(.mar-star.is-on) {
  opacity: 1;
}

/* The grid every library page shares. */
.mar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.mar-grid.is-wide {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
/* The list every library page shares is the one table: ../table/table.css. */
</style>
