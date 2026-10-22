<script setup lang="ts">
import {
  Activity,
  AppWindow,
  Box,
  Check,
  CircleArrowUp,
  Clock,
  Cloud,
  Folder,
  Home,
  Laptop,
  Settings2,
  Tag,
  X
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { DesignMenuItem } from '../types/ipc'

/** A file-menu row (label + check), or a design-prototype row
 *  (DesignMenuItem: icon, status dot, second line, trailing note, and an
 *  "open in a new window" action). */
interface MenuItem extends DesignMenuItem {
  /** English fallback when `labelKey` is set. */
  label?: string
  labelKey?: string
}

defineProps<{
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'activate', id: string): void
}>()

const { t } = useI18n()

const ICONS = {
  home: Home,
  local: Laptop,
  cloud: Cloud,
  settings: Settings2,
  window: AppWindow,
  folder: Folder,
  version: Tag,
  status: Activity,
  clock: Clock,
  source: Box,
  update: CircleArrowUp,
  close: X
} as const

function labelFor(item: MenuItem): string {
  if (item.labelKey) return t(item.labelKey, item.label ?? '')
  return item.label ?? ''
}

function handleClick(item: MenuItem): void {
  // Separators, headings, titles and facts are not actions.
  if (item.kind) return
  if (!item.id) return
  emit('activate', item.id)
}
</script>

<template>
  <ul class="menu">
    <template v-for="(item, idx) in items" :key="idx">
      <li v-if="item.kind === 'separator'" class="separator" role="separator" />
      <li v-else-if="item.kind === 'heading'" class="heading" role="presentation">
        {{ item.label }}
      </li>
      <!-- A card's head: what it is, and its state -->
      <li v-else-if="item.kind === 'title'" class="title" role="presentation">
        <span v-if="item.icon" class="icon">
          <component :is="ICONS[item.icon]" :size="18" />
          <span v-if="item.status" :class="['dot', `is-${item.status}`]" />
        </span>
        <span class="text">
          <span class="title-label">{{ item.label }}</span>
          <span v-if="item.detail" class="detail">{{ item.detail }}</span>
        </span>
      </li>
      <!-- A fact: label on the left, value on the right -->
      <li v-else-if="item.kind === 'info'" class="info" role="presentation">
        <span v-if="item.icon" class="icon">
          <component :is="ICONS[item.icon]" :size="15" />
        </span>
        <span class="info-label">{{ item.label }}</span>
        <span class="info-value">
          <span v-if="item.status" :class="['dot', 'inline', `is-${item.status}`]" />{{ item.meta }}
        </span>
      </li>
      <li
        v-else-if="item.icon"
        :class="['item', 'rich', { 'has-detail': item.detail, 'is-current': item.checked }]"
        role="menuitem"
        tabindex="-1"
        @click="handleClick(item)"
      >
        <span class="icon">
          <component :is="ICONS[item.icon]" :size="16" />
          <span v-if="item.status" :class="['dot', `is-${item.status}`]" />
        </span>
        <span class="text">
          <span class="label">{{ labelFor(item) }}</span>
          <span v-if="item.detail" class="detail">{{ item.detail }}</span>
        </span>
        <span v-if="item.meta" class="meta">{{ item.meta }}</span>
        <button
          v-if="item.altId"
          type="button"
          class="alt"
          :title="item.altLabel"
          :aria-label="item.altLabel"
          @click.stop="emit('activate', item.altId)"
        >
          <AppWindow :size="14" />
        </button>
      </li>
      <li v-else class="item" role="menuitem" tabindex="-1" @click="handleClick(item)">
        <span class="check">
          <Check v-if="item.checked" :size="14" />
        </span>
        <span class="label">{{ labelFor(item) }}</span>
      </li>
    </template>
  </ul>
</template>

<style scoped>
.menu {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  height: 28px;
  box-sizing: border-box;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.08s;
}
.item:hover {
  background: rgba(255, 255, 255, 0.1);
}
:global(.popup.is-light) .item:hover {
  background: rgba(0, 0, 0, 0.07);
}

.check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.85;
}

.label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}

.separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--border, #494a50);
  opacity: 0.6;
}

/* Design-prototype rows. Heights match main's computePopupHeight:
 * heading 28, row / info 32, row with a second line 48, title 56. */
.title {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  box-sizing: border-box;
  padding: 0 10px;
}
.title-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
}
.info {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  box-sizing: border-box;
  padding: 0 10px;
  white-space: nowrap;
}
.info .icon {
  opacity: 0.5;
}
.info-label {
  flex-shrink: 0;
  opacity: 0.6;
}
.info-value {
  display: inline-flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dot.inline {
  position: static;
  box-shadow: none;
}
.heading {
  display: flex;
  align-items: flex-end;
  height: 28px;
  box-sizing: border-box;
  padding: 0 10px 6px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.5;
}
.item.rich.has-detail {
  height: 48px;
}
.item.rich.is-current {
  background: rgba(255, 255, 255, 0.06);
}
.icon {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  opacity: 0.75;
}
.dot {
  position: absolute;
  right: -3px;
  bottom: -2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--neutral-800, #1c1c21);
}
.dot.is-open,
.dot.is-running {
  background: oklch(0.78 0.15 155);
}
.dot.is-starting {
  background: oklch(0.82 0.14 85);
}
.dot.is-stopped {
  background: oklch(0.6 0.005 285);
}
.dot.is-error {
  background: oklch(0.62 0.19 25);
}
.text {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.detail {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  opacity: 0.55;
}
.meta {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.5;
}
/* Scoped to the row so it beats the app's global button style (whose
 * padding would squeeze the icon to nothing). */
.item.rich .alt {
  display: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  margin: 0;
  padding: 0;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
  opacity: 0.85;
  cursor: pointer;
}
.item.rich .alt svg {
  flex-shrink: 0;
}
.item.rich:hover .alt {
  display: inline-flex;
}
.item.rich:hover .alt + .meta,
.item.rich:hover .meta:has(+ .alt) {
  display: none;
}
.item.rich .alt:hover {
  background: rgba(255, 255, 255, 0.12);
  opacity: 1;
}
</style>
