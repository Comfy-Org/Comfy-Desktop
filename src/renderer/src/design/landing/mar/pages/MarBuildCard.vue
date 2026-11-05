<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Cloud, Laptop } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import MarItem from './MarItem.vue'
import MarSplitButton from './MarSplitButton.vue'
import MarStatus, { type ItemStatus } from './MarStatus.vue'
import type { BuildCard } from './buildCard'
import type { MenuLine } from './menu'

/**
 * One build with no picture (UI Playground › Build card). Text on the card's
 * surface and a quiet button, so the page reads as a list of places to run,
 * not a gallery. Where it runs: a tile beside the name, labelled above it
 * (tile, the pick), a strip across the top (strip), a
 * labelled line on top (where), a mark beside the name (mark), or the group's
 * heading (grouped). MarItem keeps selection, the ⋯ menu and rename.
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
  line,
  tone = 'idle',
  gear,
  usage,
  usageLabel,
  counts,
  cta,
  second,
  busy = false,
  lines,
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
  /** Split: the state as a badge with no fill, then where it runs. */
  line?: { state: string; rest: string }
  tone?: 'ok' | 'warn' | 'bad' | 'idle'
  gear?: string
  /** Share of memory in use while it runs, 0 to 100. */
  usage?: number
  usageLabel?: string
  counts?: string
  cta: { label: string; icon: unknown; run: () => void }
  /** The state's other frequent action (Stop while it runs), as an icon
   *  beside the button, so it never needs the ⋯ menu. */
  second?: { label: string; hint?: string; icon: unknown; run: () => void }
  busy?: boolean
  lines: MenuLine[]
  renaming?: boolean
  fav?: boolean
}>()
// Open and Start say where (a narrow card drops it); Try again stays short.
const splitSuffix = computed(() =>
  ['Open', 'Start'].includes(cta.label)
    ? kind === 'cloud'
      ? 'on Cloud'
      : 'on this computer'
    : undefined
)
const emit = defineEmits<{
  open: []
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
    :selectable="false"
    :renaming
    ratio="auto"
    class="mar-bc"
    :class="`is-${look}`"
    @open="emit('open')"
    @start-rename="emit('start-rename')"
    @rename="emit('rename', $event)"
    @cancel-rename="emit('cancel-rename')"
    @star="emit('star')"
  >
    <template #media>
      <span v-if="look === 'tile' || look === 'split'" class="mar-bc-tile">
        <component :is="kind === 'cloud' ? Cloud : Laptop" :size="look === 'split' ? 16 : 24" />
      </span>
      <span v-else-if="look === 'strip'" class="mar-bc-strip">
        <component :is="kind === 'cloud' ? Cloud : Laptop" :size="14" />{{ where }}
      </span>
      <span v-else-if="look === 'where'" class="mar-bc-where">
        <LocationIcon :kind :size="15" />{{ where }}
      </span>
      <span v-else-if="look === 'mark'" class="mar-row-icon">
        <LocationIcon :kind :size="18" />
      </span>
    </template>
    <template v-if="look === 'tile'" #eyebrow>
      <span class="mar-bc-eyebrow">{{ where }}</span>
    </template>
    <template v-if="look === 'split'" #meta>
      <span class="mar-bc-line truncate">{{ line?.rest }}</span>
    </template>
    <template v-else-if="error" #meta>
      <span class="mar-bc-error">{{ error }}</span>
    </template>
    <template #footer>
      <!-- Split: one action, its sibling (Stop, Update) in the chevron. -->
      <span v-if="look === 'split'" class="mar-bc-foot">
        <span class="mar-bc-badge" :class="`is-${tone}`"
          ><i aria-hidden="true" />{{ line?.state }}</span
        >
        <MarSplitButton
          tone="secondary"
          :label="busy ? 'Starting…' : cta.label"
          :suffix="busy || !splitSuffix ? undefined : splitSuffix"
          :disabled="busy"
          :lines="
            second ? [{ label: second.label, icon: second.icon as Component, run: second.run }] : []
          "
          menu-label="More ways to run"
          @run="cta.run()"
        />
      </span>
      <span v-else class="mar-bc-foot">
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
          <MarStatus
            v-if="status"
            :status
            :label="statusLabel"
            :class="status === 'update' && 'mar-bc-says-update'"
          />
          <span v-if="note" class="truncate">{{ note }}</span>
        </span>
        <span class="mar-bc-acts">
          <Button
            v-if="second"
            variant="ghost"
            size="sm"
            class="mar-bc-second"
            :title="second.hint"
            @click.stop="second.run()"
            ><component :is="second.icon as Component" :size="13" />{{ second.label }}</Button
          >
          <Button
            variant="secondary"
            size="sm"
            class="mar-bc-main"
            :disabled="busy"
            @click.stop="cta.run()"
          >
            <component :is="cta.icon as Component" :size="13" />{{ busy ? 'Starting…' : cta.label }}
          </Button>
        </span>
      </span>
    </template>
  </MarItem>
</template>

<style>
/* A narrow card drops the Update available chip: its Update button
   already says it. */
@container (max-width: 360px) {
  .mar-bc.is-split .mar-split-suffix {
    display: none;
  }
}
@container (max-width: 300px) {
  .mar-bc-says-update {
    display: none !important;
  }
}
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
.mar-bc-where {
  display: flex;
  height: 20px;
  align-items: center;
  gap: 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
/* Why it didn't start, in plain words: the Failed to start chip is the
   one red signal. */
.mar-bc-error {
  overflow: hidden;
  color: var(--color-muted-foreground);
  text-overflow: ellipsis;
}
.mar-bc-foot {
  container-type: inline-size;
  display: flex;
  min-width: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
}
.mar-bc-acts {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
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
/* Strip: where it runs, as a grey band across the card's top; the fill sets
   it apart, no lines. Both places share the grey; the icon and the label
   tell them apart. */
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-bc.is-strip {
  padding-top: 0;
}
.mar-bc.is-strip > .mar-item-media {
  display: flex;
  height: 36px;
  align-items: center;
  margin: 0 -16px;
  padding: 0 16px;
  border-radius: 0;
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
/* Contrast: the specs and the state's words between secondary and tertiary
   text (over 6:1 in dark). The card reads by its fill, like the rest. */
.mar-bc.is-strip .mar-item-meta,
.mar-bc.is-strip .mar-bc-error,
.mar-bc.is-strip .mar-bc-state {
  color: color-mix(in oklch, var(--color-muted-foreground) 55%, var(--color-subtle-foreground));
}
.mar-bc-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-base-foreground);
  font-size: 12px;
  font-weight: 500;
}
.mar-bc-strip > svg {
  color: var(--color-muted-foreground);
}
/* ⋯ sits at the strip's end. */
.mar-bc.is-strip .mar-item-tools {
  top: 4px;
  right: 8px;
}
/* The state's other action (Stop, Update) is outlined, so the main button
   stays the one with a fill, and a fill that reads on the card. */
:root .proto-ui.proto-ui.proto-ui .mar-bc-second {
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-main:not(:disabled) {
  border-color: transparent;
  background: color-mix(in oklch, var(--color-base-foreground) 15%, transparent);
  box-shadow: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-main:not(:disabled):hover {
  background: color-mix(in oklch, var(--color-base-foreground) 20%, transparent);
}
/* Tile: where it runs as a tile as tall as the three lines beside it
   (where, name, specs); the state and its actions under a hairline. */
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-bc.is-tile {
  grid-template-columns: 60px minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  column-gap: 14px;
}
.mar-bc-tile {
  display: flex;
  width: 60px;
  height: 60px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
.mar-bc.is-tile > .mar-item-text {
  height: 60px;
  justify-content: center;
  gap: 4px;
  padding-right: 28px;
}
.mar-bc-eyebrow {
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  line-height: 16px;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc.is-tile .mar-item-name {
  font-size: 15px;
  line-height: 20px;
}
.mar-bc.is-tile .mar-item-meta {
  line-height: 16px;
}
.mar-bc.is-tile .mar-bc-foot {
  grid-column: 1 / -1;
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
/* Split: a small mark of where it runs beside the name, the specs under
   it, then the state as a badge with no fill and one action across. */
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-bc.is-split {
  grid-template-columns: 16px minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  column-gap: 8px;
}
.mar-bc.is-split .mar-bc-tile {
  width: 16px;
  height: 20px;
  background: none;
  color: var(--color-muted-foreground);
}
.mar-bc.is-split > .mar-item-text {
  gap: 4px;
  padding-right: 28px;
}
.mar-bc.is-split .mar-item-name,
.mar-bc.is-split .mar-bc-line {
  line-height: 20px;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc.is-split .mar-item-name {
  font-size: 15px;
}
.mar-bc-line {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: var(--color-muted-foreground);
}
.mar-bc-badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mar-bc-badge.is-ok {
  color: var(--color-status-running);
}
.mar-bc-badge.is-warn {
  color: var(--color-status-warning, #f5b14c);
}
.mar-bc-badge.is-bad {
  color: var(--color-status-danger);
}
.mar-bc-badge > i {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
}
.mar-bc-badge:not(.is-idle) > i {
  background: currentColor;
}
.mar-bc.is-split .mar-item-meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-bc.is-split .mar-bc-foot {
  grid-column: 1 / -1;
  align-items: center;
  margin-top: 4px;
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
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-bc {
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
