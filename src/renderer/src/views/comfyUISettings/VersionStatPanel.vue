<script setup lang="ts">
/**
 * The Update tab's version summary: a headline with a status badge, over a
 * bordered table of version facts.
 *
 * Extracted from `ChannelPicker` so a distribution install - which has versions
 * but no release channel - gets the SAME table rather than a stacked list that
 * merely says the same words. Purely presentational: callers decide what the
 * rows mean.
 */
import type { ActionDef, VersionStatRow } from '../../types/ipc'
import SectionActionButton from './SectionActionButton.vue'

export type { VersionStatRow }

const props = withDefaults(
  defineProps<{
    headline: string
    headlineProduct?: string
    /** Accent the headline (an update is waiting). */
    headlineHighlight?: boolean
    badge?: string | null
    badgeTone?: 'current' | 'update'
    rows?: VersionStatRow[]
    /** Rendered inside the table's bottom edge, right-aligned - they act on
     *  what the table states, so they belong to it rather than the page. */
    actions?: ActionDef[]
    runningActionIds?: Set<string>
  }>(),
  {
    headlineProduct: '',
    headlineHighlight: false,
    badge: null,
    badgeTone: 'current',
    rows: () => [],
    actions: () => [],
    runningActionIds: () => new Set<string>()
  }
)

const emit = defineEmits<{ action: [action: ActionDef] }>()

function isRunning(id: string): boolean {
  return props.runningActionIds.has(id)
}
</script>

<template>
  <div class="version-stat-panel">
    <div class="version-stat-headline-row">
      <p class="version-stat-headline">
        <span v-if="headlineProduct" class="channel-picker-headline-product">{{
          headlineProduct
        }}</span>
        <span
          class="channel-picker-headline-version"
          :class="{ 'is-update-available': headlineHighlight }"
          >{{ headline }}</span
        >
      </p>
      <span v-if="badge" class="version-stat-badge channel-picker-badge" :class="badgeTone">{{
        badge
      }}</span>
    </div>

    <dl v-if="rows.length > 0 || actions.length > 0" class="version-stat-rows">
      <div
        v-for="row in rows"
        :key="row.id"
        class="version-stat-row"
        :class="{ 'is-highlight': row.highlight }"
      >
        <dt>{{ row.label }}</dt>
        <dd :title="row.title">{{ row.value }}</dd>
      </div>

      <div v-if="actions.length > 0" class="version-stat-actions">
        <SectionActionButton
          v-for="action in actions"
          :key="action.id"
          :action="action"
          :running="isRunning(action.id)"
          button-class="version-stat-action"
          tooltip-class="version-stat-action-tooltip"
          spinner-class="version-stat-action-spinner"
          disable-with-message
          direct-style-class
          @action="emit('action', action)"
        />
      </div>
    </dl>
  </div>
</template>

<style scoped>
.version-stat-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-stat-headline-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.version-stat-headline {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
  color: var(--text);
}

.version-stat-headline .is-update-available {
  color: var(--accent);
}

.version-stat-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  border-radius: 999px;
}

.version-stat-badge.current {
  color: var(--success, #4ade80);
  background: color-mix(in srgb, var(--success, #4ade80) 12%, transparent);
}

.version-stat-badge.update {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.version-stat-rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  padding: 4px 12px;
  background: var(--brand-surface-bg);
}

.version-stat-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border-hover);
}

.version-stat-row:first-child {
  border-top: none;
}

.version-stat-row dt {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-muted);
}

.version-stat-row dd {
  margin: 0;
  font-size: 13px;
  line-height: 19px;
  color: var(--neutral-100);
  text-align: right;
}

.version-stat-row.is-highlight dd {
  color: var(--accent);
  font-weight: 500;
}

/* Inside the table's bottom edge, sharing the row divider so the buttons read
 * as the table's own footer rather than a detached block. */
.version-stat-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-top: 1px solid var(--border-hover);
}

.version-stat-rows > .version-stat-actions:first-child {
  border-top: none;
}

.version-stat-action-tooltip {
  flex: 0 0 auto;
}

:deep(.version-stat-action) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--chooser-surface-border);
  background: var(--brand-surface-bg);
  color: var(--neutral-100);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  box-sizing: border-box;
  transition:
    background-color 100ms ease,
    filter 100ms ease;
}

:deep(.version-stat-action:hover:not(:disabled)),
:deep(.version-stat-action:focus-visible:not(:disabled)) {
  background: var(--brand-surface-bg-hover);
  outline: none;
}

:deep(.version-stat-action.primary) {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

:deep(.version-stat-action:disabled) {
  opacity: 0.5;
  cursor: default;
}

:deep(.version-stat-action.is-running) {
  cursor: progress;
  opacity: 0.85;
}

:deep(.version-stat-action-spinner) {
  flex: 0 0 auto;
  animation: version-stat-action-spin 0.9s linear infinite;
}

@keyframes version-stat-action-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
