<script setup lang="ts">
import {
  Activity,
  Check,
  CircleArrowUp,
  Clock,
  Cloud,
  Folder,
  LayoutGrid,
  Laptop,
  Server,
  Settings2,
  Tag,
  X
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import StatusDot from '../design-system/components/StatusDot.vue'
import type { TitleMenuIcon, TitleMenuRow } from '../types/ipc'

/** A file-menu row (label + check), or a breadcrumb menu row (TitleMenuRow:
 *  icon, status dot, second line, trailing note). */
interface MenuItem extends TitleMenuRow {
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

const ICONS: Record<TitleMenuIcon, typeof Check> = {
  builds: LayoutGrid,
  local: Laptop,
  cloud: Cloud,
  remote: Server,
  settings: Settings2,
  folder: Folder,
  version: Tag,
  status: Activity,
  clock: Clock,
  update: CircleArrowUp,
  close: X
}

function labelFor(item: MenuItem): string {
  if (item.labelKey) return t(item.labelKey, item.label ?? '')
  return item.label ?? ''
}

function handleClick(item: MenuItem): void {
  // Separators, headings, card titles and facts are not actions.
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
      <!-- A card's head: what it is, and where it lives. -->
      <li v-else-if="item.kind === 'title'" class="title" role="presentation">
        <span v-if="item.icon" class="icon">
          <component :is="ICONS[item.icon]" :size="18" />
          <StatusDot v-if="item.status" :status="item.status" class="dot" />
        </span>
        <span class="text">
          <span class="title-label">{{ item.label }}</span>
          <span v-if="item.detail" class="detail">{{ item.detail }}</span>
        </span>
      </li>
      <!-- A fact: label on the left, value on the right. -->
      <li v-else-if="item.kind === 'info'" class="info" role="presentation">
        <span v-if="item.icon" class="icon">
          <component :is="ICONS[item.icon]" :size="15" />
        </span>
        <span class="info-label">{{ item.label }}</span>
        <span class="info-value">
          <StatusDot v-if="item.status" :status="item.status" />{{ item.meta }}
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
          <StatusDot v-if="item.status" :status="item.status" class="dot" />
        </span>
        <span class="text">
          <span class="label">{{ labelFor(item) }}</span>
          <span v-if="item.detail" class="detail">{{ item.detail }}</span>
        </span>
        <span v-if="item.meta" class="meta">{{ item.meta }}</span>
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
  padding: 4px;
  /* Main caps the popup at the window; a longer menu scrolls. */
  max-height: 100vh;
  overflow-y: auto;
  box-sizing: border-box;
}
/* 32px rows with an 8px radius inside the menu's 4px inset (the design
 * system's menu). Row height is mirrored in main: POPUP_ITEM_HEIGHT in
 * main/popups/titlePopup.ts. */
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  height: 32px;
  border-radius: var(--radius-control);
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
  margin: 4px 6px;
  background: var(--border, #494a50);
  opacity: 0.6;
}

/* The breadcrumb menus' rows. Heights match main's computePopupHeight:
 * heading 28, row / fact 32, row with a second line 48, card title 56. */
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
  font-size: var(--text-heading);
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
  background: var(--color-secondary-background);
}
.icon {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  opacity: 0.75;
}
/* A status dot on an icon's corner, cut out of the menu surface. */
.dot {
  position: absolute;
  right: -3px;
  bottom: -2px;
  box-shadow: 0 0 0 2px var(--neutral-800);
}
.text {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
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
</style>
