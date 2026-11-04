<script setup lang="ts">
import type { Component } from 'vue'
import Button from '../../ui/Button.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import MarItem from './MarItem.vue'
import MarStatus, { type ItemStatus } from './MarStatus.vue'
import type { BuildCard } from './buildCard'
import type { MenuLine } from './menu'

/**
 * One build with no picture (UI Playground › Build card). Text on the card's
 * surface and a quiet button, so the page reads as a list of places to run,
 * not a gallery. Where it runs: a labelled line on top (where), a mark beside
 * the name (mark), or the group's heading (grouped). MarItem keeps selection,
 * the ⋯ menu and rename.
 */
const {
  look,
  name,
  kind,
  where,
  meta,
  error,
  status,
  statusLabel,
  note,
  gear,
  usage,
  usageLabel,
  counts,
  cta,
  busy = false,
  lines,
  selected = false,
  selecting = false,
  renaming = false,
  fav
} = defineProps<{
  look: Exclude<BuildCard, 'photos'>
  name: string
  kind: 'local' | 'cloud'
  where: string
  meta?: string
  error?: string
  status?: ItemStatus
  statusLabel?: string
  /** The state in a few quiet words, beside the chip or on its own. */
  note?: string
  gear?: string
  /** Share of memory in use while it runs, 0 to 100. */
  usage?: number
  usageLabel?: string
  counts?: string
  cta: { label: string; icon: unknown; run: () => void }
  busy?: boolean
  lines: MenuLine[]
  selected?: boolean
  selecting?: boolean
  renaming?: boolean
  fav?: boolean
}>()
const emit = defineEmits<{
  open: []
  select: [range: boolean]
  'start-rename': []
  rename: [name: string]
  'cancel-rename': []
  star: []
}>()
</script>

<template>
  <MarItem
    :name
    :meta="error ? undefined : look === 'mark' ? `${where} · ${meta}` : meta"
    :fav
    :lines
    :selected
    :selecting
    :renaming
    ratio="auto"
    class="mar-bc"
    :class="`is-${look}`"
    @open="emit('open')"
    @select="emit('select', $event)"
    @start-rename="emit('start-rename')"
    @rename="emit('rename', $event)"
    @cancel-rename="emit('cancel-rename')"
    @star="emit('star')"
  >
    <template #media>
      <span v-if="look === 'where'" class="mar-bc-where">
        <LocationIcon :kind :size="15" />{{ where }}
      </span>
      <span v-else-if="look === 'mark'" class="mar-row-icon">
        <LocationIcon :kind :size="18" />
      </span>
    </template>
    <template v-if="error" #meta>
      <span class="mar-bc-error">{{ error }}</span>
    </template>
    <template #footer>
      <span class="mar-bc-foot">
        <!-- The specs stay on Mark: hardware, memory, what's installed. -->
        <span v-if="look === 'mark'" class="mar-bc-specs">
          <span class="mar-bc-gear">
            <span class="truncate">{{ gear }}</span>
            <span v-if="usage !== undefined" class="mar-bc-bar" :aria-label="usageLabel" role="img"
              ><i :style="{ width: `${usage}%` }"
            /></span>
            <span class="tabular-nums">{{ usageLabel }}</span>
          </span>
          <span v-if="counts" class="truncate">{{ counts }}</span>
        </span>
        <span class="mar-bc-state">
          <MarStatus v-if="status" :status :label="statusLabel" />
          <span v-if="note" class="truncate">{{ note }}</span>
        </span>
        <Button variant="secondary" size="sm" :disabled="busy" @click.stop="cta.run()">
          <component :is="cta.icon as Component" :size="13" />{{ busy ? 'Starting…' : cta.label }}
        </Button>
      </span>
    </template>
  </MarItem>
</template>

<style>
/* Text on the surface: no ring, no strip, more air. */
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-bc {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 10px;
  padding: 16px;
}
/* The media slot holds a line or a mark, not a picture. */
.mar-bc > .mar-item-media {
  position: static;
  overflow: visible;
  background: none;
}
.mar-bc > .mar-item-text {
  gap: 4px;
  padding: 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc .mar-item-name {
  font-size: 14px;
  font-weight: 600;
}
/* ⋯ and the check sit at the card's corner, out of the text's way. */
.mar-bc .mar-item-tools {
  top: 12px;
  right: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc .mar-kebab.on-media {
  background: transparent;
  backdrop-filter: none;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc .mar-kebab.on-media:is(:hover, .is-open) {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc .mar-item-check {
  top: 16px;
  right: 44px;
  left: auto;
  background: transparent;
  backdrop-filter: none;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--color-base-foreground) 35%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc.is-selected .mar-item-check {
  background: var(--color-base-foreground);
  box-shadow: none;
  color: var(--color-inverted-foreground);
}
.mar-bc-where {
  display: flex;
  height: 20px;
  align-items: center;
  gap: 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.mar-bc-error {
  overflow: hidden;
  color: var(--color-status-danger);
  text-overflow: ellipsis;
}
.mar-bc-foot {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
}
.mar-bc-state {
  display: flex;
  min-width: 0;
  height: 28px;
  align-items: center;
  gap: 8px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
/* Mark: the mark beside the name, the specs under a hairline. */
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-bc.is-mark {
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  column-gap: 12px;
}
.mar-bc.is-mark > .mar-item-text {
  justify-content: center;
  padding-right: 28px;
}
.mar-bc.is-mark .mar-bc-foot {
  flex-wrap: wrap;
  grid-column: 1 / -1;
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-bc-specs {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  line-height: 18px;
}
.mar-bc-gear {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--color-muted-foreground);
}
/* The figure keeps its place at the right, with or without the bar. */
.mar-bc-gear > .truncate {
  margin-right: auto;
}
.mar-bc-bar {
  position: relative;
  width: 48px;
  height: 4px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
.mar-bc-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--color-muted-foreground);
}
/* Light: white on white needs a faint ring to read as a card, and the
   amber needs more weight on it (the same pair as the Photos card). */
:root[data-ds-theme='light']
  .proto-ui.proto-ui.proto-ui
  .mar-item.is-grid.mar-bc:not(.is-selected) {
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root[data-ds-theme='light'] .mar-bc .mar-status.is-warn {
  color: oklch(0.55 0.14 70);
}
/* Grouped: the group says where, once, with what all of it shares. */
.mar-bc-group + .mar-bc-group {
  margin-top: 28px;
}
.mar-bc-group-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mar-bc-group-hint {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
