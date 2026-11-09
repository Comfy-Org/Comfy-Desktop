<script setup lang="ts">
import { ChevronDown, ListFilter } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import { floatingSurface } from '../../ui/menu.styles'
import { PORTAL_TO } from '../../ui/portal'
import AssetFilterFields from './AssetFilterFields.vue'
import { activeFilters, type AssetFilter } from './assetFilters'

/** Desktop's Filters menu: the shared fields behind one field-styled
 *  trigger that counts what's on. */
defineProps<{ tags: string[]; count: number }>()
const f = defineModel<AssetFilter>({ required: true })
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            fieldVariants({}),
            'w-auto cursor-pointer gap-2 pr-2 outline-none focus-visible:border-border-focus data-[state=open]:border-border-strong'
          )
        "
      >
        <ListFilter :size="14" class="shrink-0 text-subtle-foreground" />
        <span class="aff-label">Filters</span>
        <span v-if="activeFilters(f)" class="aff-badge">{{ activeFilters(f) }}</span>
        <ChevronDown :size="13" class="aff-chev ml-1 shrink-0 text-subtle-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverPortal :to="PORTAL_TO">
      <PopoverContent align="end" :side-offset="6" :class="cn(floatingSurface, 'p-3')">
        <AssetFilterFields
          v-model="f"
          :types="[
            { value: 'text', label: 'Text' },
            { value: 'other', label: 'Other' }
          ]"
          :tags
          :count
        />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
.aff-badge {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
</style>
