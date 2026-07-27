<script setup lang="ts">
/**
 * The Update tab's version summary: a headline with a status badge, over a
 * bordered table of version facts.
 *
 * Extracted from `ChannelPicker` so a distribution install — which has versions
 * but no release channel — gets the SAME table rather than a stacked list that
 * merely says the same words. Purely presentational: callers decide what the
 * rows mean.
 */
import type { VersionStatRow } from '../../types/ipc'

export type { VersionStatRow }

withDefaults(
  defineProps<{
    headline: string
    /** Accent the headline (an update is waiting). */
    headlineHighlight?: boolean
    badge?: string | null
    badgeTone?: 'current' | 'update'
    rows?: VersionStatRow[]
  }>(),
  { headlineHighlight: false, badge: null, badgeTone: 'current', rows: () => [] }
)
</script>

<template>
  <div class="version-stat-panel">
    <div class="version-stat-headline-row">
      <p class="version-stat-headline" :class="{ 'is-update-available': headlineHighlight }">
        {{ headline }}
      </p>
      <span v-if="badge" class="version-stat-badge" :class="badgeTone">{{ badge }}</span>
    </div>

    <dl v-if="rows.length > 0" class="version-stat-rows">
      <div
        v-for="row in rows"
        :key="row.id"
        class="version-stat-row"
        :class="{ 'is-highlight': row.highlight }"
      >
        <dt>{{ row.label }}</dt>
        <dd :title="row.title">{{ row.value }}</dd>
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
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
  color: var(--text);
}

.version-stat-headline.is-update-available {
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
</style>
