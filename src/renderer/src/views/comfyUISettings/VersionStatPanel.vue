<script setup lang="ts">
/**
 * The Update tab's version summary: a headline with a status badge, over a
 * bordered table of version facts.
 *
 * Extracted from `ChannelPicker` so a Builder install - which has versions
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

function actionButtonClass(action: ActionDef): string {
  const base =
    'version-stat-action inline-flex h-[30px] flex-none items-center justify-center gap-1.5 rounded-lg border border-solid bg-[var(--brand-surface-bg)] px-3.5 py-0 text-[13px] leading-none whitespace-nowrap transition-[background-color,filter] duration-100 ease-[ease] disabled:hover:bg-[var(--brand-surface-bg)] enabled:hover:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:outline-none'
  return `${base} ${isRunning(action.id) ? 'cursor-progress opacity-85 disabled:cursor-progress disabled:opacity-85' : 'disabled:cursor-default disabled:opacity-50'}`
}

function isRunning(id: string): boolean {
  return props.runningActionIds.has(id)
}
</script>

<template>
  <div class="version-stat-panel flex flex-col gap-3">
    <div class="version-stat-headline-row flex flex-wrap items-center gap-2">
      <p
        class="version-stat-headline m-0 flex flex-wrap items-baseline gap-1.5 text-[18px] leading-6 font-semibold text-text"
      >
        <span v-if="headlineProduct" class="channel-picker-headline-product">{{
          headlineProduct
        }}</span>
        <span
          class="channel-picker-headline-version"
          :class="{ 'is-update-available text-[var(--accent)]': headlineHighlight }"
          >{{ headline }}</span
        >
      </p>
      <span
        v-if="badge"
        class="version-stat-badge shrink-0 rounded-[999px] px-2 py-0.5 text-[11px] leading-4 font-medium channel-picker-badge"
        :class="
          badgeTone === 'update'
            ? 'update text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]'
            : 'current text-[var(--success,#4ade80)] bg-[color-mix(in_srgb,var(--success,#4ade80)_12%,transparent)]'
        "
        >{{ badge }}</span
      >
    </div>

    <dl
      v-if="rows.length > 0 || actions.length > 0"
      class="version-stat-rows m-0 flex flex-col rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-3 py-1"
    >
      <div
        v-for="row in rows"
        :key="row.id"
        class="version-stat-row grid grid-cols-2 items-center gap-3 border-t border-solid border-border-hover py-2 first:border-t-0"
        :class="{ 'is-highlight': row.highlight }"
      >
        <dt class="m-0 text-[12px] leading-4 text-text-muted">{{ row.label }}</dt>
        <dd
          class="m-0 text-right text-[13px] leading-[19px]"
          :class="row.highlight ? 'font-medium text-[var(--accent)]' : 'text-neutral-100'"
          :title="row.title"
        >
          {{ row.value }}
        </dd>
      </div>

      <div
        v-if="actions.length > 0"
        class="version-stat-actions flex flex-wrap items-center justify-end gap-2 border-t border-solid border-border-hover py-2.5 first:border-t-0"
      >
        <SectionActionButton
          v-for="action in actions"
          :key="action.id"
          :action="action"
          :running="isRunning(action.id)"
          :button-class="actionButtonClass(action)"
          :variant-class="
            action.style === 'primary'
              ? 'border-[var(--accent)] text-background font-semibold enabled:hover:bg-[var(--accent-hover)] enabled:hover:border-[var(--accent-hover)] enabled:hover:focus-visible:bg-[var(--accent-hover)]'
              : 'border-[var(--chooser-surface-border)] text-neutral-100 font-medium'
          "
          tooltip-class="version-stat-action-tooltip flex-none"
          spinner-class="version-stat-action-spinner flex-none animate-spin [animation-duration:0.9s]"
          disable-with-message
          direct-style-class
          @action="emit('action', action)"
        />
      </div>
    </dl>
  </div>
</template>
