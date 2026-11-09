<script setup lang="ts">
import { activeFilters, noFilter, type AssetFilter, type AssetType } from './assetFilters'

/**
 * The fields of the asset filters, shared by Desktop's Filters menu and
 * ComfyUI's sidebar so both read the same: where it came from, more
 * types, a date range, tags, and how many assets that leaves.
 */
const {
  types,
  typesLabel = 'More types',
  source = true,
  tags,
  count
} = defineProps<{
  types: { value: AssetType; label: string }[]
  typesLabel?: string
  /** Off where tabs already split generated from imported. */
  source?: boolean
  tags: string[]
  count: number
}>()
const f = defineModel<AssetFilter>({ required: true })

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
</script>

<template>
  <div class="aff">
    <div v-if="source" class="aff-row">
      <span class="aff-k">Asset source</span>
      <div class="aff-chips" role="radiogroup" aria-label="Asset source">
        <button
          v-for="s in ['generated', 'imported'] as const"
          :key="s"
          type="button"
          role="radio"
          class="aff-chip"
          :aria-checked="f.source === s"
          @click="f = { ...f, source: f.source === s ? 'all' : s }"
        >
          {{ s === 'generated' ? 'Generated' : 'Imported' }}
        </button>
      </div>
    </div>
    <div class="aff-row">
      <span class="aff-k">{{ typesLabel }}</span>
      <div class="aff-chips">
        <button
          v-for="t in types"
          :key="t.value"
          type="button"
          class="aff-chip"
          :aria-pressed="f.types.includes(t.value)"
          @click="f = { ...f, types: toggle(f.types, t.value) }"
        >
          {{ t.label }}
        </button>
      </div>
    </div>
    <label class="aff-row">
      <span class="aff-k">From</span>
      <input
        type="date"
        class="aff-date"
        :value="f.from"
        :max="f.to || undefined"
        @input="f = { ...f, from: ($event.target as HTMLInputElement).value }"
      />
    </label>
    <label class="aff-row">
      <span class="aff-k">To</span>
      <input
        type="date"
        class="aff-date"
        :value="f.to"
        :min="f.from || undefined"
        @input="f = { ...f, to: ($event.target as HTMLInputElement).value }"
      />
    </label>
    <div v-if="tags.length" class="aff-tags" aria-label="Tags">
      <button
        v-for="t in tags"
        :key="t"
        type="button"
        class="aff-chip is-tag"
        :aria-pressed="f.tags.includes(t)"
        @click="f = { ...f, tags: toggle(f.tags, t) }"
      >
        # {{ t }}
      </button>
    </div>
    <div class="aff-foot">
      <span>{{ count ? `${count} asset${count === 1 ? '' : 's'}` : 'No assets' }}</span>
      <button v-if="activeFilters(f)" type="button" class="aff-reset" @click="f = noFilter()">
        Reset
      </button>
    </div>
  </div>
</template>

<style>
.aff {
  display: flex;
  min-width: 264px;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px;
  font-size: 12px;
}
.aff-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.aff-k {
  flex: none;
  color: var(--color-muted-foreground);
  white-space: nowrap;
}
.aff-chips {
  justify-content: flex-end;
}
.aff-chips,
.aff-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.aff-tags {
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .aff-chip {
  height: 24px;
  padding: 0 9px;
  border-radius: 7px;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .aff-chip.is-tag {
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .aff-chip:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .aff-chip[aria-checked='true'],
:root .proto-ui.proto-ui.proto-ui .aff-chip[aria-pressed='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  color: var(--color-base-foreground);
}
.aff-date {
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.aff-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-muted-foreground);
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .aff-reset {
  padding: 0;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 12px;
}
</style>
