<script setup lang="ts">
import { computed } from 'vue'
import { Cloud, Ellipsis, Laptop } from 'lucide-vue-next'
import { hostActions, toast } from '../../useProto'
import { recent, type RecentItem } from './P04Recent'

/**
 * 13 · Library table: Recently used as a quiet table you can scan by
 * column (name, project, build, status, when). One translucent sheet, rows
 * split by a faint rule; the row opens the workflow on its build, ••• has
 * the rest.
 */
const rows = computed(() => recent.value.slice(0, 6))

type Status = { label: string; tone: 'running' | 'done' | 'failed' }
function status(r: RecentItem): Status {
  if (r.env?.state === 'running') return { label: 'Running', tone: 'running' }
  if (r.env?.state === 'error') return { label: 'Failed', tone: 'failed' }
  return { label: 'Done', tone: 'done' }
}
const open = (r: RecentItem): void => {
  if (r.env) hostActions.launch(r.env, r.w.name)
}
</script>

<template>
  <div class="p13-sheet overflow-hidden rounded-[16px]" role="table" aria-label="Recently used">
    <div
      class="p13-grid p13-head h-10 items-center pr-3 pl-4 text-[11px] font-medium tracking-[0.04em] text-subtle-foreground uppercase"
      role="row"
    >
      <span role="columnheader">Name</span>
      <span role="columnheader">Project</span>
      <span role="columnheader">Build</span>
      <span role="columnheader">Status</span>
      <span role="columnheader">Updated</span>
      <span role="columnheader" class="sr-only">Actions</span>
    </div>
    <div
      v-for="r in rows"
      :key="r.w.id"
      class="p13-grid p13-row h-[54px] cursor-default items-center pr-3 pl-4 text-ui outline-none"
      role="row"
      tabindex="0"
      @click="open(r)"
      @keydown.enter="open(r)"
    >
      <span class="flex min-w-0 items-center gap-2.5" role="cell">
        <img :src="r.src" alt="" class="size-9 shrink-0 rounded-[7px] object-cover" />
        <span class="truncate font-medium text-base-foreground">{{ r.title }}</span>
      </span>
      <span class="truncate text-muted-foreground" role="cell">{{ r.w.project ?? '—' }}</span>
      <span class="flex min-w-0 items-center gap-2.5 text-muted-foreground" role="cell">
        <component
          :is="r.env?.kind === 'cloud' ? Cloud : Laptop"
          :size="13"
          class="shrink-0 text-subtle-foreground"
        />
        <span class="truncate">{{ r.env?.name ?? 'Unknown build' }}</span>
      </span>
      <span role="cell">
        <span :class="['p13-chip', `is-${status(r).tone}`]">
          <span v-if="status(r).tone === 'running'" class="size-1.5 rounded-full bg-current" />{{
            status(r).label
          }}
        </span>
      </span>
      <span class="truncate text-muted-foreground" role="cell">{{ r.w.modified }}</span>
      <span role="cell" class="flex justify-end">
        <button
          type="button"
          class="p13-more"
          :aria-label="`More for ${r.title}`"
          @click.stop="toast(`${r.title}: rename, duplicate, delete`)"
        >
          <Ellipsis :size="16" />
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.p13-sheet {
  background-color: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(24px);
}
.p13-grid {
  display: grid;
  grid-template-columns:
    minmax(0, 2.25fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.95fr)
    minmax(0, 0.95fr) 40px;
  column-gap: 16px;
}
.p13-head {
  background-color: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
}
.p13-row {
  box-shadow: inset 0 1px 0 color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  transition: background-color 120ms ease;
}
.p13-row:hover,
.p13-row:focus-visible {
  background-color: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
}
.p13-row:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}
.p13-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 7px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 500;
  backdrop-filter: blur(12px);
}
.p13-chip.is-running {
  color: var(--color-status-running);
  background-color: color-mix(in oklch, var(--color-status-running) 14%, transparent);
}
.p13-chip.is-done {
  color: var(--color-muted-foreground);
  background-color: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.p13-chip.is-failed {
  color: var(--color-status-danger);
  background-color: color-mix(in oklch, var(--color-status-danger) 14%, transparent);
}
</style>

<style>
:root .proto-ui.proto-ui.proto-ui .p13-more {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p13-more:hover {
  color: var(--color-base-foreground);
  background-color: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
</style>
