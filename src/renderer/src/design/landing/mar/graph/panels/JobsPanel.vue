<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AlertCircle,
  ArrowUpDown,
  CheckCheck,
  Ellipsis,
  ListFilter,
  ListX,
  LoaderCircle,
  MoreHorizontal,
  Search,
  X,
  Zap
} from 'lucide-vue-next'
import RailPanel from './RailPanel.vue'
import { PAST_JOBS } from './panelData'
import type { RunJob } from '../runEngine'

/**
 * Job History (ComfyUI's JobHistorySidebarTab): tabs for All, Completed
 * and (when any failed) Failed; search with filter and sort; a summary
 * of what runs and waits, with Clear queue; then the jobs by day. This
 * graph's runs lead, live; earlier ones follow. A finished job reads
 * "Finished in" on Comfy Cloud and its file name on a local build.
 */
const { jobs, cloud } = defineProps<{ jobs: RunJob[]; cloud: boolean }>()
const emit = defineEmits<{ close: []; cancel: [id: string]; clearQueue: []; view: [] }>()

const failed = PAST_JOBS.filter((j) => j.failed)
const TABS = computed(() => ['All', 'Completed', ...(failed.length ? ['Failed'] : [])])
const tab = ref('All')
const query = ref('')
const menu = ref<'' | 'filter' | 'sort' | 'more'>('')
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
</script>

<template>
  <RailPanel title="Job History" @close="emit('close')">
    <template #tools>
      <span class="rp-anchor">
        <button
          type="button"
          class="rp-icon"
          title="More"
          aria-label="More options"
          @click="menu = menu === 'more' ? '' : 'more'"
        >
          <MoreHorizontal :size="15" />
        </button>
        <div v-if="menu === 'more'" class="rp-menu is-end">
          <button type="button" class="rp-row" @click="menu = ''">Docked Job History</button>
          <button type="button" class="rp-row" @click="menu = ''">Show run progress bar</button>
          <template v-if="!cloud">
            <span class="rp-menu-sep" />
            <button type="button" class="rp-row is-danger" @click="menu = ''">
              <span class="rp-row-text"
                >Clear job history<small>Media assets won't be deleted.</small></span
              >
            </button>
          </template>
        </div>
      </span>
    </template>
    <template #header>
      <div class="rp-tabs" role="tablist">
        <button
          v-for="t in TABS"
          :key="t"
          type="button"
          role="tab"
          class="rp-tab"
          :class="tab === t && 'is-on'"
          :aria-selected="tab === t"
          @click="tab = t"
        >
          {{ t }}
        </button>
      </div>
      <div class="rp-top">
        <label class="rp-search"
          ><Search :size="14" /><input v-model="query" type="search" placeholder="Search Jobs..."
        /></label>
        <span class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-filled"
            title="Filter by"
            aria-label="Filter jobs"
            @click="menu = menu === 'filter' ? '' : 'filter'"
          >
            <ListFilter :size="15" /><i v-if="scope !== 'All workflows'" class="rp-dot" />
          </button>
          <div v-if="menu === 'filter'" class="rp-menu is-end">
            <button
              v-for="o in ['All workflows', 'Current workflow']"
              :key="o"
              type="button"
              class="rp-row"
              :class="scope === o && 'is-on'"
              @click="((scope = o), (menu = ''))"
            >
              {{ o }}
            </button>
          </div>
        </span>
        <span class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-filled"
            title="Sort by"
            aria-label="Sort jobs"
            @click="menu = menu === 'sort' ? '' : 'sort'"
          >
            <ArrowUpDown :size="15" />
          </button>
          <div v-if="menu === 'sort'" class="rp-menu is-end">
            <button
              v-for="o in ['Most recent', 'Total generation time (longest first)']"
              :key="o"
              type="button"
              class="rp-row"
              :class="order === o && 'is-on'"
              @click="((order = o), (menu = ''))"
            >
              {{ o }}
            </button>
          </div>
        </span>
      </div>
      <div class="jp-summary">
        <span>{{ summary }}</span>
        <span class="jp-clear"
          >Clear queue
          <button
            type="button"
            class="rp-icon"
            aria-label="Clear queue"
            :disabled="!queued.length"
            @click="emit('clearQueue')"
          >
            <ListX :size="14" />
          </button>
        </span>
      </div>
    </template>

    <div class="rp-list">
      <!-- This graph's runs, live. -->
      <template v-if="live.length">
        <p class="jp-day">Today</p>
        <div
          v-for="j in live"
          :key="j.id"
          class="jp-row"
          :class="j.status === 'running' && 'is-running'"
        >
          <span
            v-if="j.status !== 'queued'"
            class="jp-bar"
            :style="{ width: `${j.progress * 100}%` }"
          />
          <span class="jp-thumb">
            <Zap v-if="j.status === 'running'" :size="14" />
            <LoaderCircle v-else :size="14" class="jp-spin" />
          </span>
          <span class="jp-text">
            <span>{{
              j.status === 'queued'
                ? 'In queue...'
                : j.status === 'paused'
                  ? 'Paused'
                  : `Total: ${Math.round(j.progress * 100)}%`
            }}</span>
            <small>{{ j.title }}</small>
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
        <p class="jp-day">{{ d.day }}</p>
        <div v-for="j in d.items" :key="j.id" class="jp-row" @dblclick="!j.failed && emit('view')">
          <span class="jp-thumb">
            <img v-if="j.src" :src="j.src" alt="" />
            <AlertCircle v-else-if="j.failed" :size="14" />
            <CheckCheck v-else :size="14" />
          </span>
          <span class="jp-text">
            <span>{{
              j.failed ? 'Failed' : cloud ? `Finished in ${j.seconds.toFixed(1)}s` : j.file
            }}</span>
            <small>{{ j.failed ?? `${j.seconds.toFixed(2)}s` }}</small>
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
      <p v-if="!live.length && !days.length" class="rp-empty">No jobs match “{{ query }}”.</p>
    </div>
  </RailPanel>
</template>

<style>
.rp-anchor {
  position: relative;
  display: inline-flex;
}
.rp-menu.is-end {
  top: calc(100% + 4px);
  right: 0;
}
.rp-row small {
  display: block;
  color: var(--mg-dim);
  font-size: 11px;
}
.rp-row.is-danger,
.rp-icon.is-danger:hover {
  color: var(--color-danger-foreground, #e5484d);
}
.jp-summary {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 8px 16px;
  color: var(--mg-muted);
  font-size: 12px;
}
.jp-clear {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--mg-text);
}
.jp-clear .rp-icon {
  width: 26px;
  height: 26px;
}
:root .proto-ui.proto-ui.proto-ui .jp-clear .rp-icon:disabled {
  opacity: 0.35;
}
.jp-day {
  margin: 10px 0 6px;
  padding: 0 8px;
  color: var(--mg-dim);
  font-size: 12px;
}
.jp-row {
  position: relative;
  display: flex;
  height: 48px;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  padding: 0 8px;
  border-radius: var(--mar-tab-item-radius);
}
.jp-row:hover {
  background: var(--mg-hover);
}
.jp-row.is-running {
  background: var(--rp-chip);
}
.jp-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, #0b8ce9 16%, transparent);
  transition: width 0.2s linear;
  pointer-events: none;
}
.jp-thumb {
  position: relative;
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 6px;
  background: var(--rp-chip);
  color: var(--mg-muted);
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
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  font-size: 12px;
}
.jp-text > span,
.jp-text small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.jp-text small {
  color: var(--mg-dim);
  font-size: 11.5px;
}
.jp-actions {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
}
.jp-row:hover .jp-actions,
.jp-row:focus-within .jp-actions {
  opacity: 1;
}
</style>
