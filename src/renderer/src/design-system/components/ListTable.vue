<script setup lang="ts" generic="T">
import { computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import Card from './Card.vue'
import Skeleton from './Skeleton.vue'
import { cn } from '../cn'

interface ListColumn {
  key: string
  label: string
  /** Grid track, e.g. `120px`. Default: takes the remaining width. */
  width?: string
  align?: 'start' | 'end'
}

const SKELETON_ROWS = 6

/** Rows of items with a column header, in a card. Rows are actions when
 *  `interactive` (click, Enter or Space emits `activate`). While `loading`
 *  with no rows yet, skeleton rows stand in. Cells render `row[key]` unless
 *  a `cell-<key>` slot is given. */
const {
  columns,
  rows,
  rowKey,
  interactive = false,
  loading = false,
  loadingLabel,
  class: className
} = defineProps<{
  columns: ListColumn[]
  rows: T[]
  rowKey: (row: T) => string
  interactive?: boolean
  loading?: boolean
  /** Announced while the skeleton shows. */
  loadingLabel: string
  class?: HTMLAttributes['class']
}>()
const emit = defineEmits<{ activate: [row: T] }>()

const showSkeleton = computed(() => loading && !rows.length)
const gridStyle = computed(() => ({
  gridTemplateColumns: columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ')
}))

function cellClass(column: ListColumn): string {
  return cn('min-w-0 truncate', column.align === 'end' && 'text-right tabular-nums')
}

function valueOf(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}
</script>

<template>
  <div :class="className">
    <span role="status" class="sr-only">{{ showSkeleton ? loadingLabel : '' }}</span>
    <Card role="table" :aria-busy="showSkeleton" class="overflow-hidden">
      <div
        role="row"
        class="grid h-10 items-center gap-4 border-b border-border-default px-4 text-ui text-subtle-foreground"
        :style="gridStyle"
      >
        <span v-for="c in columns" :key="c.key" role="columnheader" :class="cellClass(c)">{{
          c.label
        }}</span>
      </div>
      <template v-if="showSkeleton">
        <div
          v-for="i in SKELETON_ROWS"
          :key="i"
          role="row"
          aria-hidden="true"
          class="grid min-h-12 items-center gap-4 border-b border-border-default px-4 last:border-b-0"
          :style="gridStyle"
        >
          <Skeleton
            v-for="(c, ci) in columns"
            :key="c.key"
            :class="cn(ci === 0 ? 'w-3/5' : 'w-2/3', c.align === 'end' && 'ml-auto w-12')"
          />
        </div>
      </template>
      <div
        v-for="row in rows"
        :key="rowKey(row)"
        role="row"
        :tabindex="interactive ? 0 : undefined"
        :class="
          cn(
            'grid min-h-12 items-center gap-4 border-b border-border-default px-4 text-ui last:border-b-0',
            interactive &&
              'cursor-pointer outline-none transition-colors duration-150 hover:bg-secondary-background focus-visible:bg-secondary-background'
          )
        "
        :style="gridStyle"
        @click="interactive && emit('activate', row)"
        @keydown.enter="interactive && emit('activate', row)"
        @keydown.space.prevent="interactive && emit('activate', row)"
      >
        <span v-for="c in columns" :key="c.key" role="cell" :class="cellClass(c)">
          <slot :name="`cell-${c.key}`" :row="row">{{ valueOf(row, c.key) }}</slot>
        </span>
      </div>
    </Card>
  </div>
</template>
