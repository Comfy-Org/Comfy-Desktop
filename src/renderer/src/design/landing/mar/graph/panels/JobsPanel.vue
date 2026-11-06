<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AlertCircle,
  CheckCheck,
  Ellipsis,
  History,
  ListX,
  LoaderCircle,
  MoreHorizontal,
  SearchX,
  SlidersHorizontal,
  X,
  Zap
} from 'lucide-vue-next'
import MarSpin from '../../brand/MarSpin.vue'
import RailPanel from './RailPanel.vue'
import { PAST_JOBS } from './panelData'
import type { RunJob } from '../runEngine'
import MarSeg from '../../pages/MarSeg.vue'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarEmpty from '../../pages/MarEmpty.vue'

/**
 * Job History (ComfyUI's JobHistorySidebarTab) with the DS's parts: tabs
 * for All, Completed and (when any failed) Failed; search with one
 * button for filter and sort; a strip with what runs and waits, and
 * Clear queue; then the jobs by day, this graph's live runs first. A
 * finished job reads "Finished in" on Comfy Cloud and its file name on a
 * local build; the other line carries the rest, never the same fact.
 */
const { jobs, cloud } = defineProps<{ jobs: RunJob[]; cloud: boolean }>()
const emit = defineEmits<{ close: []; cancel: [id: string]; clearQueue: []; view: [] }>()

const failed = PAST_JOBS.filter((j) => j.failed)
const TABS = computed(() =>
  ['All', 'Completed', ...(failed.length ? ['Failed'] : [])].map((t) => ({ value: t, label: t }))
)
const tab = ref('All')
const query = ref('')
const menu = ref<'' | 'filter' | 'more'>('')
const scope = ref('All workflows')
const order = ref('Most recent')

const running = computed(() => jobs.filter((j) => j.status === 'running' || j.status === 'paused'))
const queued = computed(() => jobs.filter((j) => j.status === 'queued'))
const summary = computed(() => {
  const r = running.value.length
  const q = queued.value.length
  if (!r && !q) return 'No active jobs'
  if (r && q) return `${r} running, ${q} queued`
  return r ? `${r} running` : `${q} queued`
})

const past = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = PAST_JOBS.filter(
    (j) =>
      (tab.value === 'All' || (tab.value === 'Failed' ? !!j.failed : !j.failed)) &&
      (!q || `${j.file} ${j.id}`.toLowerCase().includes(q))
  )
  return order.value === 'Most recent' ? list : [...list].sort((a, b) => b.seconds - a.seconds)
})
const days = computed(() =>
  (['Today', 'Yesterday'] as const)
    .map((d) => ({ day: d, items: past.value.filter((j) => j.day === d) }))
    .filter((d) => d.items.length)
)
const live = computed(() => (tab.value === 'All' && !query.value ? jobs : []))
const bare = (file: string): string => file.replace(/\.[a-z0-9]+$/i, '')
</script>

<template>
  <RailPanel title="Job History" @close="emit('close')">
    <template #tools>
      <span class="rp-anchor">
        <button
          type="button"
          class="rp-icon"
          :class="menu === 'more' && 'is-on'"
          title="More options"
          aria-label="More options"
          @click="menu = menu === 'more' ? '' : 'more'"
        >
          <MoreHorizontal :size="15" />
        </button>
        <div v-if="menu === 'more'" class="rp-menu is-end" role="menu">
          <button type="button" role="menuitem" class="rp-row" @click="menu = ''">
            Docked Job History
          </button>
          <button type="button" role="menuitem" class="rp-row" @click="menu = ''">
            Show run progress bar
          </button>
          <template v-if="!cloud">
            <span class="rp-menu-sep" />
            <button type="button" role="menuitem" class="rp-row is-danger" @click="menu = ''">
              <span class="rp-row-text"
                >Clear job history<small>Media assets won't be deleted.</small></span
              >
            </button>
          </template>
        </div>
      </span>
    </template>
    <template #header>
      <MarSeg v-model="tab" :options="TABS" label="Jobs" />
      <div class="rp-top">
        <MarSearchField v-model="query" placeholder="Search Jobs..." />
        <span class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-field"
            :class="menu === 'filter' && 'is-on'"
            title="Filter and sort"
            aria-label="Filter and sort"
            :aria-expanded="menu === 'filter'"
            @click="menu = menu === 'filter' ? '' : 'filter'"
          >
            <SlidersHorizontal :size="15" /><i v-if="scope !== 'All workflows'" class="rp-dot" />
          </button>
          <div v-if="menu === 'filter'" class="rp-menu is-end" role="menu">
            <p class="rp-menu-label">Filter by</p>
            <button
              v-for="o in ['All workflows', 'Current workflow']"
              :key="o"
              type="button"
              role="menuitemradio"
              class="rp-row"
              :data-state="scope === o ? 'checked' : 'unchecked'"
              @click="((scope = o), (menu = ''))"
            >
              {{ o }}
            </button>
            <span class="rp-menu-sep" />
            <p class="rp-menu-label">Sort by</p>
            <button
              v-for="o in ['Most recent', 'Total generation time (longest first)']"
              :key="o"
              type="button"
              role="menuitemradio"
              class="rp-row"
              :data-state="order === o ? 'checked' : 'unchecked'"
              @click="((order = o), (menu = ''))"
            >
              {{ o }}
            </button>
          </div>
        </span>
      </div>
      <div class="jp-summary" :class="{ 'is-busy': running.length + queued.length > 0 }">
        <span class="jp-pulse" aria-hidden="true" />
        <span class="jp-summary-text">{{ summary }}</span>
        <button
          type="button"
          class="rp-btn jp-clear"
          :disabled="!queued.length"
          @click="emit('clearQueue')"
        >
          <ListX :size="13" />Clear queue
        </button>
      </div>
    </template>

    <div class="rp-list">
      <!-- This graph's runs, live. -->
      <template v-if="live.length">
        <p class="rp-section">Today</p>
        <div
          v-for="j in live"
          :key="j.id"
          class="jp-row"
          :class="j.status === 'running' && 'is-running'"
        >
          <span class="jp-thumb">
            <Zap v-if="j.status === 'running'" :size="15" />
            <MarSpin v-else :icon="LoaderCircle" :size="15" spin="jp-spin" />
          </span>
          <span class="jp-text">
            <span class="jp-name">{{ j.title }}</span>
            <span class="jp-meta">{{
              j.status === 'queued'
                ? 'In queue...'
                : j.status === 'paused'
                  ? 'Paused'
                  : `Total: ${Math.round(j.progress * 100)}%`
            }}</span>
            <span v-if="j.status !== 'queued'" class="jp-track"
              ><i :style="{ width: `${j.progress * 100}%` }"
            /></span>
          </span>
          <span class="jp-actions">
            <button
              type="button"
              class="rp-icon is-danger"
              aria-label="Cancel"
              title="Cancel"
              @click="emit('cancel', j.id)"
            >
              <X :size="14" />
            </button>
          </span>
        </div>
      </template>

      <template v-for="d in days" :key="d.day">
        <p class="rp-section">{{ d.day }}</p>
        <div
          v-for="j in d.items"
          :key="j.id"
          class="jp-row"
          :class="j.failed && 'is-failed'"
          :title="j.file"
          @dblclick="!j.failed && emit('view')"
        >
          <span class="jp-thumb">
            <img v-if="j.src" :src="j.src" alt="" />
            <AlertCircle v-else-if="j.failed" :size="15" />
            <CheckCheck v-else :size="15" />
          </span>
          <span class="jp-text">
            <span class="jp-name">{{
              j.failed ? 'Failed' : cloud ? `Finished in ${j.seconds.toFixed(1)}s` : bare(j.file)
            }}</span>
            <span class="jp-meta">{{
              j.failed ?? (cloud ? bare(j.file) : `${j.seconds.toFixed(1)}s`)
            }}</span>
          </span>
          <span class="jp-actions">
            <button v-if="!j.failed" type="button" class="rp-btn" @click="emit('view')">
              View
            </button>
            <button type="button" class="rp-icon" aria-label="More" title="More">
              <Ellipsis :size="14" />
            </button>
          </span>
        </div>
      </template>
    </div>
    <MarEmpty
      v-if="!live.length && !days.length"
      compact
      :icon="query ? SearchX : History"
      :title="query ? 'No results' : 'No jobs yet'"
      :text="query ? `No jobs match “${query}”.` : 'Runs of this workflow will show up here.'"
      :action="query ? 'Clear search' : undefined"
      @action="query = ''"
    />
  </RailPanel>
</template>

<style>
/* What runs and waits: a quiet strip, with a pulse while busy. */
.jp-summary {
  display: flex;
  height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--rp-chip);
  font-size: 12.5px;
}
.jp-summary-text {
  min-width: 0;
  flex: 1;
  color: var(--rp-meta);
}
.jp-summary.is-busy .jp-summary-text {
  color: var(--rp-text);
}
.jp-pulse {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
.jp-summary.is-busy .jp-pulse {
  background: #0b8ce9;
  box-shadow: 0 0 0 3px color-mix(in srgb, #0b8ce9 25%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .jp-clear {
  height: 28px;
  background: transparent;
  color: var(--rp-text);
}
:root .proto-ui.proto-ui.proto-ui .jp-clear:hover:not(:disabled) {
  background: var(--rp-hover);
}
:root .proto-ui.proto-ui.proto-ui .jp-clear:disabled {
  opacity: 0.45;
}
/* Rows on the DS's list item metrics: 52 high, a 40px picture. */
.jp-row {
  position: relative;
  display: flex;
  height: 52px;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
  border-radius: var(--mar-tab-radius);
  transition: background-color 120ms ease;
}
.jp-row:hover {
  background: var(--rp-hover);
}
.jp-row.is-running {
  background: var(--rp-raised);
  box-shadow: var(--rp-raised-shadow);
}
.jp-thumb {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 9px;
  background: var(--rp-chip-on);
  color: var(--rp-meta);
}
.jp-row.is-running .jp-thumb {
  color: #0b8ce9;
}
.jp-row.is-failed .jp-thumb {
  background: color-mix(in srgb, #e5484d 16%, transparent);
  color: #e5484d;
}
.jp-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.jp-spin {
  animation: sg-spin 0.9s linear infinite;
}
.jp-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
.jp-name,
.jp-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.jp-name {
  color: var(--rp-text);
  font-size: 13px;
  font-weight: 500;
}
.jp-meta {
  color: var(--rp-meta);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.jp-row.is-failed .jp-name {
  color: #e5484d;
}
.jp-track {
  height: 3px;
  margin-top: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--rp-chip-on);
}
.jp-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #0b8ce9;
  transition: width 0.2s linear;
}
.jp-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.jp-row:hover .jp-actions,
.jp-row:focus-within .jp-actions,
.jp-row.is-running .jp-actions {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .jp-row,
  .jp-actions,
  .jp-track i {
    transition: none;
  }
}
</style>
